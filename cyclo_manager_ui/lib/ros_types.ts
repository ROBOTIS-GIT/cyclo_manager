// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Howon Kim

export type OccupancyGrid = {
  header?: { frame_id?: string };
  info?: {
    resolution?: number;
    width?: number;
    height?: number;
    origin?: Pose;
  };
  data?: number[];
};

export type Pose = {
  position?: { x?: number; y?: number; z?: number };
  orientation?: { x?: number; y?: number; z?: number; w?: number };
};

export type PoseStamped = {
  header?: { frame_id?: string };
  pose?: Pose;
};

export type LaserScan = {
  header?: { frame_id?: string };
  angle_min?: number;
  angle_increment?: number;
  range_min?: number;
  range_max?: number;
  ranges?: Array<number | null>;
};

export type PathMsg = {
  poses?: PoseStamped[];
};

export type PolygonStamped = {
  header?: { frame_id?: string };
  polygon?: {
    points?: Array<{ x?: number; y?: number; z?: number }>;
  };
};

export type TransformStamped = {
  header?: { frame_id?: string };
  child_frame_id?: string;
  transform?: {
    translation?: { x?: number; y?: number; z?: number };
    rotation?: { x?: number; y?: number; z?: number; w?: number };
  };
};

export type TfMsg = {
  transforms?: TransformStamped[];
};

export type MapInteractionMode = "view" | "goal" | "initial";
