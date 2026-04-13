"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EditorProvider } from "@/components/editor/editor-context";
import { TimelineProvider } from "@/context/TimelineContext";
import { RecordingContainer } from "@/components/recording/RecordingContainer";
import { getProject } from "@/lib/storage";

export default function RecordingPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId;

  const [meta, setMeta] = useState<{ id: string; name: string; width: number; height: number; background?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    (async () => {
      try {
        const project = await getProject(projectId);
        if (project) {
          setMeta({
            id: project.id,
            name: project.name,
            width: project.width ?? 390,
            height: project.height ?? 844,
          });
        } else {
          router.replace("/projects");
        }
      } catch {
        router.replace("/projects");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, router]);

  if (loading || !meta || !projectId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <EditorProvider projectId={projectId} initialMeta={meta}>
      <TimelineProvider>
        <RecordingContainer
          onBackClick={() => router.push(`/editor/${projectId}`)}
        />
      </TimelineProvider>
    </EditorProvider>
  );
}
