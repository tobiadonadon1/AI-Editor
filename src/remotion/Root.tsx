import { Composition, type CalculateMetadataFunction } from "remotion";
import { EditVideo } from "./EditVideo";
import { FPS, HEIGHT, WIDTH, emptyEdit, type EditVideoProps } from "../shared/project";
import { buildTimeline } from "../shared/timeline";

export const calculateEditMetadata: CalculateMetadataFunction<EditVideoProps> = ({ props }) => {
  const { project } = props;
  const timeline = buildTimeline(project.words, project.edit, project.source?.durationSec ?? 1, FPS);
  return {
    durationInFrames: timeline.durationInFrames,
    defaultOutName: `${project.name || project.id}.mp4`,
  };
};

const now = new Date(0).toISOString();
const placeholder: EditVideoProps = {
  videoSrc: "",
  project: {
    version: 1,
    id: "preview",
    name: "Preview",
    createdAt: now,
    updatedAt: now,
    brief: "",
    status: "draft",
    words: [],
    edit: emptyEdit(),
    render: { status: "idle", progress: 0 },
  },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Edit"
    component={EditVideo}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={30}
    defaultProps={placeholder}
    calculateMetadata={calculateEditMetadata}
  />
);
