"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Image from "next/image";
import Link from "next/link";
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Download,
  FlaskConical,
  FolderOpen,
  ListChecks,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import logo from "../../assets/logo - 1.png";

export type WorkspaceSection = "jobs" | "library" | "shortlists" | "exports";

const navigation = [
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness, href: "/jobs" },
  { id: "library", label: "Resume library", icon: FolderOpen, href: "/" },
  { id: "shortlists", label: "Shortlists", icon: ListChecks, href: "/shortlists" },
  { id: "exports", label: "Exports", icon: Download, href: "/exports" },
] as const;

export function WorkspaceShell({
  section,
  children,
  demo = false,
  returnTo = "/",
  jobId,
  onNavigate,
  status,
  beforeNavigate,
}: {
  section: WorkspaceSection;
  children: ReactNode;
  demo?: boolean;
  returnTo?: string;
  jobId?: string;
  onNavigate?: (section: WorkspaceSection) => void;
  status?: ReactNode;
  beforeNavigate?: () => boolean;
}) {
  const current = navigation.find((item) => item.id === section)!;
  const workspaceHref = `${current.href}${jobId ? `?job=${jobId}` : ""}`;
  return (
    <div className="inbox-shell organized-workspace">
      <aside className="inbox-sidebar" aria-label="Workspace navigation">
        <Link
          href={demo ? "/demo" : "/jobs"}
          className="brand"
          aria-label="RoleLens home"
          onNavigate={(event) => {
            if (beforeNavigate && !beforeNavigate()) event.preventDefault();
          }}
        >
          <Image src={logo} alt="RoleLens" sizes="176px" loading="eager" />
        </Link>
        <div className="workspace-caption">{demo ? "Example workspace" : "Hiring workspace"}</div>
        <nav className="workspace-navigation" aria-label="Main navigation">
          {navigation
            .filter((item) => demo || item.id !== "shortlists")
            .map((item) => {
              const content = (
                <>
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </>
              );
              const className = `nav-item ${section === item.id ? "active" : ""}`;
              return demo ? (
                <button
                  key={item.id}
                  className={className}
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => onNavigate?.(item.id)}
                >
                  {content}
                </button>
              ) : (
                <Link
                  key={item.id}
                  className={className}
                  aria-current={section === item.id ? "page" : undefined}
                  href={`${item.href}${jobId ? `?job=${jobId}` : ""}`}
                  onNavigate={(event) => {
                    if (beforeNavigate && !beforeNavigate()) event.preventDefault();
                  }}
                >
                  {content}
                </Link>
              );
            })}
        </nav>
        <div className="sidebar-spacer" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="workspace-profile" aria-label="Workspace profile">
            <span className="profile-avatar">RL</span>
            <span>
              <strong>{demo ? "Demo workspace" : "My workspace"}</strong>
              <small>{demo ? "Fictional sample data" : "Local installation"}</small>
            </span>
            <ChevronDown size={14} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="profile-menu"
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={12}
            >
              <DropdownMenu.Label className="profile-menu-label">Workspace</DropdownMenu.Label>
              <DropdownMenu.Item asChild>
                <Link
                  href={demo ? returnTo : `/demo?returnTo=${encodeURIComponent(workspaceHref)}`}
                  className="profile-menu-item"
                  onNavigate={(event) => {
                    if (beforeNavigate && !beforeNavigate()) event.preventDefault();
                  }}
                >
                  {demo ? <LogOut size={15} /> : <FlaskConical size={15} />}
                  {demo ? "Back to workspace" : "Open demo"}
                </Link>
              </DropdownMenu.Item>
              {demo && (
                <DropdownMenu.Item
                  className="profile-menu-item"
                  onSelect={() => window.location.reload()}
                >
                  <FlaskConical size={15} />
                  Reset demo
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </aside>
      <div className="inbox-main">
        {demo && (
          <div className="demo-banner" role="status">
            <FlaskConical size={17} />
            <div>
              <strong>Demo mode</strong>
              <span>
                200 fictional resumes · preset results · no Jev calls or integrations. Changes reset
                on reload.
              </span>
            </div>
            <Link href={returnTo} className="button button-secondary">
              <LogOut size={14} />
              Back to workspace
            </Link>
          </div>
        )}
        <header className="topbar">
          <div className="breadcrumb">
            {demo ? "Demo" : "Workspace"}
            <ChevronRight size={12} />
            <span>{current.label}</span>
          </div>
          {status ?? (demo ? <span className="workspace-mode">Sample data</span> : null)}
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
