import type { Metadata } from "next";
import { WorkspaceHome } from "@/components/workspace-home";
import "../auth.css";

export const metadata: Metadata = { title: "Your workspace | JR Xpert HMS", robots: { index: false, follow: false } };

export default function WorkspacePage() {
  return <WorkspaceHome />;
}
