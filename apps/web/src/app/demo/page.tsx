import { DemoWorkspace } from "@/components/demo-workspace";
import { safeWorkspaceReturn } from "@/lib/workspace-links";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  return <DemoWorkspace returnTo={safeWorkspaceReturn(params.returnTo)} />;
}
