import { Suspense } from "react";
import { JobInbox } from "@/components/job-inbox";
export default function JobsPage() {
  return (
    <Suspense fallback={<p className="workspace-loading">Loading jobs…</p>}>
      <JobInbox section="jobs" />
    </Suspense>
  );
}
