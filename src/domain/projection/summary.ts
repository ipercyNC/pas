import type { ProjectionSnapshot } from "./types";

export function projectionHeadline(snapshot: ProjectionSnapshot): string {
  return `${snapshot.policyId} @ ${snapshot.asOfDate}`;
}

export function hasValueImpact(snapshot: ProjectionSnapshot): boolean {
  return snapshot.appliedEvents.some((event) => Object.values(event.delta).some((value) => value !== 0));
}
