/**
 * Screenshot import: Claude reads the numbers off a screenshot of any analytics dashboard
 * and returns them as rows. Needs ANTHROPIC_API_KEY on the server.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { HttpError } from "./auth";

const Row = z.object({
  date: z.string().describe("YYYY-MM-DD for a day, or YYYY-MM for a month"),
  visitors: z.number().nullable().describe("Unique visitors / users / sessions for that period, or null if not shown"),
  pageviews: z.number().nullable().describe("Page views / views for that period, or null if not shown"),
  bounce_rate: z.number().nullable().describe("Bounce rate as a percentage 0-100, or null if not shown"),
});

const Reading = z.object({
  is_analytics: z.boolean().describe("false if the image isn't a stats dashboard, table, or chart of traffic over time"),
  provider: z.string().describe("The product the screenshot appears to come from, e.g. 'Google Analytics', or 'unknown'"),
  granularity: z.enum(["day", "month"]),
  method: z.enum(["exact", "estimated"]).describe("exact = numbers printed in the image; estimated = read off a chart's axis"),
  rows: z.array(Row),
  notes: z.string().describe("One or two short sentences for the user: what was read, and anything uncertain"),
});

export type ScreenshotReading = z.infer<typeof Reading>;

const MEDIA = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type Media = (typeof MEDIA)[number];

function instructions(today: string) {
  return `You read web analytics screenshots and turn them into data rows.

Today is ${today}. Extract one row per period (day or month) that the screenshot shows over time.
- Prefer numbers printed in the image (tables, data labels, tooltips). Use them exactly; "1.2k" means 1200.
- If the only source is a line or bar chart without printed values, estimate each point from the y-axis, set method to "estimated", and say so in notes.
- Dates: output YYYY-MM-DD (daily) or YYYY-MM (monthly). When a year isn't shown, use the most recent year that keeps every date on or before today.
- Map metric names: visitors = unique visitors, users, active users, uniques, or sessions when nothing else exists. pageviews = page views, views, pageloads. bounce_rate = bounce rate in percent.
- Leave a metric null when the screenshot doesn't show it. Never invent periods that aren't shown.
- Single totals with no time breakdown (e.g. "Visitors: 5,200 last 30 days") are not rows; mention them in notes instead.
- If the image isn't analytics at all, set is_analytics to false and return no rows.`;
}

export async function readScreenshot(base64: string, mediaType: string): Promise<ScreenshotReading> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
    throw new HttpError(503, "Screenshot import isn't set up on this server yet (it needs an ANTHROPIC_API_KEY).");
  if (!MEDIA.includes(mediaType as Media)) throw new HttpError(400, "Use a PNG, JPEG, WebP or GIF image.");
  if (base64.length > 6_500_000) throw new HttpError(413, "That image is too large. Crop it to the chart or table and try again.");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || undefined, timeout: 90_000, maxRetries: 1 });
  let response;
  try {
    response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // reading numbers off an image doesn't need deep reasoning
      output_config: { effort: "low", format: betaZodOutputFormat(Reading) },
      // if a safety classifier ever declines, retry on a fallback model in the same call
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: instructions(new Date().toISOString().slice(0, 10)),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as Media, data: base64 } },
            { type: "text", text: "Extract the traffic numbers from this screenshot." },
          ],
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "Too many screenshot reads right now. Try again in a minute.");
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The server's Anthropic API key was rejected.");
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(400, `The image couldn't be read: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new HttpError(502, "The AI service had a problem reading the image. Try again.");
    throw e;
  }
  if (response.stop_reason === "refusal") throw new HttpError(422, "The AI declined to read this image.");
  if (response.stop_reason === "max_tokens") throw new HttpError(422, "That screenshot has too many rows to read at once. Crop it into smaller parts.");
  const out = response.parsed_output;
  if (!out) throw new HttpError(502, "The AI's answer couldn't be understood. Try again.");
  return out;
}

/** Rows → CSV the regular importer understands, so the preview and save path is shared. */
export function toCsv(r: ScreenshotReading): string {
  const lines = ["date,visitors,pageviews,bounce_rate"];
  for (const row of r.rows) {
    // "2026-08" is read as a month by the importer; a month given as "2026-08-01" is trimmed back to that
    const date = r.granularity === "month" ? row.date.slice(0, 7) : row.date;
    const n = (v: number | null) => (v == null || !Number.isFinite(v) ? "" : String(Math.round(v * 100) / 100));
    lines.push([date, n(row.visitors), n(row.pageviews), row.bounce_rate == null ? "" : `${n(row.bounce_rate)}%`].join(","));
  }
  return lines.join("\n");
}
