import { useMemo } from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { buildTimeline } from "../shared/timeline";
import type { EditVideoProps } from "../shared/project";
import { Captions } from "./Captions";

export const EditVideo: React.FC<EditVideoProps> = ({ project, videoSrc }) => {
  const { fps } = useVideoConfig();
  const timeline = useMemo(
    () => buildTimeline(project.words, project.edit, project.source?.durationSec ?? 1, fps),
    [project.words, project.edit, project.source?.durationSec, fps],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {videoSrc
        ? timeline.clips.map((clip) => (
            <Sequence
              key={`${clip.srcStartFrame}-${clip.srcEndFrame}`}
              from={clip.fromFrame}
              durationInFrames={clip.durationInFrames}
              premountFor={fps}
              name={`Clip ${(clip.srcStartFrame / fps).toFixed(2)}s`}
            >
              <Video src={videoSrc} trimBefore={clip.srcStartFrame} objectFit="cover" />
            </Sequence>
          ))
        : null}
      <Captions pages={timeline.pages} style={project.edit.captionStyle} />
    </AbsoluteFill>
  );
};
