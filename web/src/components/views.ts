export const VIEWS = ["overview", "trends", "explore", "history", "snapshots", "import", "sources", "settings"] as const;
export type View = (typeof VIEWS)[number];

export const TITLES: Record<View, string> = {
  overview: "Overview",
  trends: "Trends",
  explore: "Explore",
  history: "History table",
  snapshots: "Snapshots",
  import: "Import data",
  sources: "Sources",
  settings: "Settings",
};
