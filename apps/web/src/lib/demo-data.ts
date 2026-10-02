import type { EvidenceStatus } from "./types";

export const DEMO_FOLDERS = [
  {
    id: "full-stack",
    name: "Full-stack development",
    description: "Application engineering examples",
    count: 80,
  },
  {
    id: "cloud",
    name: "Cloud engineering",
    description: "Infrastructure and operations examples",
    count: 70,
  },
  {
    id: "early-career",
    name: "Early careers",
    description: "Project and internship examples",
    count: 50,
  },
];

export const DEMO_SKILLS: Record<string, string> = {
  react: "Built React applications",
  typescript: "Used TypeScript in application development",
  node: "Built backend services with Node.js",
  postgres: "Worked with PostgreSQL databases",
  testing: "Wrote automated tests",
  aws: "Deployed services on AWS",
  terraform: "Managed infrastructure with Terraform",
  docker: "Containerized applications with Docker",
  monitoring: "Configured service monitoring and alerting",
  networking: "Configured cloud networking",
};

export type DemoResume = {
  id: string;
  name: string;
  folderId: string;
  filename: string;
  experience: "Experienced" | "Entry-level";
  skills: Record<string, EvidenceStatus>;
  text: string;
};
export type DemoJob = {
  id: string;
  title: string;
  description: string;
  experience: string;
  required: string[];
  preferred: string[];
  folderIds: string[];
};

export const DEMO_JOBS: DemoJob[] = [
  {
    id: "full-stack-job",
    title: "Full-stack Developer",
    description:
      "Build and maintain web applications, backend APIs, and reliable delivery pipelines. Collaborate with product and design on accessible customer experiences.",
    experience: "Experienced · employment and project evidence",
    required: ["react", "typescript", "node", "postgres"],
    preferred: ["testing", "aws"],
    folderIds: ["full-stack", "early-career"],
  },
  {
    id: "cloud-job",
    title: "Cloud Engineer",
    description:
      "Operate AWS infrastructure, manage changes through infrastructure as code, and improve service reliability with monitoring and network configuration.",
    experience: "Experienced · relevant infrastructure responsibilities",
    required: ["aws", "terraform", "docker", "networking"],
    preferred: ["monitoring", "testing"],
    folderIds: ["cloud", "full-stack"],
  },
];

// Invented profiles and deterministic fixtures only. No downloaded applicant data is bundled.
export const DEMO_RESUMES: DemoResume[] = Array.from({ length: 200 }, (_, index) => {
  const folderId = index < 80 ? "full-stack" : index < 150 ? "cloud" : "early-career";
  const baseSkills =
    folderId === "cloud"
      ? ["aws", "terraform", "docker", "networking", "monitoring", "testing"]
      : ["react", "typescript", "node", "postgres", "testing", "aws"];
  const skills: Record<string, EvidenceStatus> = {};
  for (const [position, skill] of baseSkills.entries()) {
    const variation = index % 5 === 0 ? 0 : (index * 7 + position * 3) % 11;
    skills[skill] = variation < 7 ? "SUPPORTED" : variation < 9 ? "PARTIAL" : "UNCLEAR";
  }
  if (folderId === "full-stack" && index % 3 === 0) skills.docker = "SUPPORTED";
  if (folderId === "early-career") skills.testing = "PARTIAL";
  const name = `Applicant ${String(index + 1).padStart(3, "0")}`;
  const experience = folderId === "early-career" ? "Entry-level" : "Experienced";
  const text = [
    `FICTIONAL DEMO RESUME — ${name}`,
    `${experience}. ${folderId === "early-career" ? "Invented project and internship profile." : "Invented employment and project profile."}`,
    ...Object.entries(skills).map(([skill, status]) =>
      status === "SUPPORTED"
        ? `${DEMO_SKILLS[skill]} for a fictional project, including implementation and maintenance.`
        : status === "PARTIAL"
          ? `Skills listed: ${skill}. Further project detail is not provided.`
          : `${skill}: involvement mentioned, but responsibility is unclear.`,
    ),
    "This sample is invented. Findings are preset illustrations, not Jev assessments.",
  ].join("\n\n");
  return {
    id: `demo-${index + 1}`,
    name,
    folderId,
    filename: `${name.replace(" ", "-")}.${index % 4 === 0 ? "docx" : "pdf"}`,
    experience,
    skills,
    text,
  };
});

export function demoAssessment(resume: DemoResume, job: DemoJob) {
  const findings = [...job.required, ...job.preferred].map((skill) => ({
    skill,
    label: DEMO_SKILLS[skill],
    required: job.required.includes(skill),
    status: resume.skills[skill] ?? ("NOT_MENTIONED" as EvidenceStatus),
  }));
  const supported = findings.filter((finding) => finding.status === "SUPPORTED");
  const partial = findings.filter((finding) => finding.status === "PARTIAL");
  const requiredSupported = supported.filter((finding) => finding.required).length;
  const preferredSupported = supported.length - requiredSupported;
  const unclear = findings.filter((finding) => finding.status === "UNCLEAR").length;
  // Coverage of fixture evidence; this is not model confidence or predicted job performance.
  const score = Math.round((100 * (supported.length + partial.length * 0.5)) / findings.length);
  const suggested = requiredSupported === job.required.length;
  return { findings, score, requiredSupported, preferredSupported, unclear, suggested };
}

export function demoCandidates(job: DemoJob, folderIds: string[]) {
  return DEMO_RESUMES.filter((resume) => folderIds.includes(resume.folderId))
    .map((resume) => ({
      resume,
      ...demoAssessment(resume, job),
    }))
    .sort((a, b) => b.score - a.score || a.resume.id.localeCompare(b.resume.id));
}

export function csvDocument(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}

export function demoCsv(job: DemoJob, resumes: DemoResume[], confirmed: string[]) {
  return csvDocument([
    [
      "Job",
      "Applicant",
      "Folder",
      "Evidence coverage (%)",
      "Required supported",
      "Preferred supported",
      "Unclear findings",
      "Review status",
      "Provenance",
    ],
    ...resumes.map((resume) => {
      const match = demoAssessment(resume, job);
      return [
        job.title,
        resume.name,
        DEMO_FOLDERS.find((folder) => folder.id === resume.folderId)!.name,
        String(match.score),
        `${match.requiredSupported}/${job.required.length}`,
        `${match.preferredSupported}/${job.preferred.length}`,
        String(match.unclear),
        confirmed.includes(resume.id) ? "Example reviewer selection" : "Unreviewed suggestion",
        "FICTIONAL DEMO — preset findings; no Jev assessment",
      ];
    }),
  ]);
}
