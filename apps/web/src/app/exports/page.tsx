import { Suspense } from "react";
import { JobInbox } from "@/components/job-inbox";
export default function ExportsPage() {
  return (
    <Suspense fallback={<p className="workspace-loading">Loading exports…</p>}>
      <JobInbox section="exports" />
    </Suspense>
  );
}
