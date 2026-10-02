import { Suspense } from "react";
import { JobInbox } from "@/components/job-inbox";
export default function Page() {
  return (
    <Suspense fallback={<p className="workspace-loading">Loading resume library…</p>}>
      <JobInbox />
    </Suspense>
  );
}
