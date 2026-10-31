/** Pure rules for the Leave project action, so they can be tested without the browser. */
export interface LeaveFailure { status: number; code: string; message: string }

/** Only people who joined someone else's project can leave it. The Owner archives instead. */
export function canLeave(project: { role: string; isOwned?: boolean } | null | undefined): boolean {
  if (!project) return false;
  return !(project.isOwned ?? project.role === 'owner');
}

export function leaveCopy(projectName: string) {
  return {
    title: `Leave ${projectName}?`,
    body: `You will lose access to this project and all of its boards straight away. Your own projects are not affected. To come back, someone has to invite you again.`,
    confirm: 'Leave project',
  };
}

/** The server's answer in plain words. Its own text mentions a container the person never sees, so the refusal is rewritten. */
export function describeLeaveFailure(failure: LeaveFailure): string {
  if (failure.status === 403) return 'The project Owner cannot leave. Archive the project instead, or ask for ownership to be handed over.';
  if (failure.status === 404) return 'You are no longer a member of this project.';
  return failure.message;
}
