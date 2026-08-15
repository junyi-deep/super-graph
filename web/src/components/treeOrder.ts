export type DropPosition = "before" | "after";

export const reorderSiblingIds = (
  siblings: string[],
  source: string,
  target: string,
  position: DropPosition,
) => {
  if (source === target) return siblings;
  const next = siblings.filter((id) => id !== source);
  const targetIndex = next.indexOf(target);
  if (targetIndex < 0) return siblings;
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
  return next;
};
