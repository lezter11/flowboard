import { ProjectView } from './project-view';

export function generateStaticParams() {
  return [{ projectId: 'proj_fashion' }];
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectView projectId={projectId} />;
}
