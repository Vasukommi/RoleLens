import { Suspense } from "react";
import { JobInbox } from "@/components/job-inbox";
export default function ShortlistsPage() {
  return (
    <Suspense fallback={<p className="workspace-loading">Loading shortlists…</p>}>
      <JobInbox section="shortlists" />
    </Suspense>
  );
}
