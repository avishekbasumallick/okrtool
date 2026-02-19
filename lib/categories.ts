export const BROAD_CATEGORIES = [
  "Uncategorized",
  "Product",
  "Engineering",
  "Growth",
  "Sales & Marketing",
  "Customer Success",
  "Operations",
  "Finance & Legal",
  "People & Culture",
  "Strategy"
] as const;

export type OkrCategory = (typeof BROAD_CATEGORIES)[number];
