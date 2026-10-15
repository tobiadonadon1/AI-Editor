import { Composition, type CalculateMetadataFunction } from "remotion";
import { EditVideo } from "./EditVideo";
import { FORMATS, FPS, mainAsset, newProject, type EditVideoProps } from "../shared/project";
import { buildTimeline } from "../shared/timeline";

// Size and length come from the project, so one composition fits every format.
export const calculateEditMetadata: CalculateMetadataFunction<EditVideoProps> = ({ props }) => {
  const { project } = props;
  const timeline = buildTimeline(project, mainAsset(project)?.durationSec ?? 0, FPS);
  const f = FORMATS[project.format];
  return {
    durationInFrames: timeline.durationInFrames,
    width: f.width,
    height: f.height,
    defaultOutName: `${project.name || project.id}.mp4`,
  };
};

const placeholder: EditVideoProps = { project: newProject("preview", "Preview", "", "9:16"), media: {}, sfx: {} };

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Edit"
    component={EditVideo}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={30}
    defaultProps={placeholder}
    calculateMetadata={calculateEditMetadata}
  />
);
