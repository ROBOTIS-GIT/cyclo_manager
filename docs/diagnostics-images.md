# Diagnostic robot images

The two front-view photos were supplied by the user. The red emergency-stop button on the lower base was removed with the built-in image_gen tool. A subsequent edit extracted the robot onto an alpha-transparent background, preserving the opaque white chest shell and head rim. The UI now uses the transparent versions over its original themed background.

- `ai-worker-fixed-transparent.png`: first attachment; W1 and the common fixed-base illustration for BG2/BH5 profiles.
- `ai-worker-wheeled-transparent.png`: second attachment; W2 and the common wheeled-base illustration for SG2/SH5 profiles.
- The previous opaque `ai-worker-fixed.png` and `ai-worker-wheeled.png` remain as edit sources.

These are illustrative region maps, not precise geometry for every profile. A1/A2/LG2 leaders use the supplied CAD images described below; Mobile retains its schematic. The original shared `/ai_worker.png` asset is unchanged.

## Leader images

The user supplied the three CAD views in the order A2, LG2, A1. The built-in
`image_gen` tool extracted each onto an alpha-transparent square canvas, removing
the large empty margins in LG2. All three final files are 1254×1254 RGBA PNGs.
The robot map selects the image by profile and scales it uniformly into a shared
frame. Each profile has its own joint coordinates. Right-arm IDs 1–8 appear on
the viewer's left and left-arm IDs 31–38 on the right, following the existing
Xacro device mapping. Close pairs have slightly offset buttons with short
connectors to their housings. These are illustration anchors, not live poses or
calibrated joint projections. Joystick sensors remain in the selectable tray.

Final workspace assets:

- `/home/gyu/ws/cyclo_manager/cyclo_manager_ui/public/diagnostics/leader-a2-transparent.png`
- `/home/gyu/ws/cyclo_manager/cyclo_manager_ui/public/diagnostics/leader-lg2-transparent.png`
- `/home/gyu/ws/cyclo_manager/cyclo_manager_ui/public/diagnostics/leader-a1-transparent.png`

Original edit targets, respectively:

- `/tmp/codex-clipboard-d88fb3d5-5ef9-4c6d-94f3-6240b1d8e20d.png`
- `/tmp/codex-clipboard-37c53dfc-04c9-4f81-8c50-d36cd45ed490.png`
- `/tmp/codex-clipboard-958c315a-5be2-4ff9-96a5-30362ee5db9a.png`

### Leader background-extraction prompt

The following prompt was used once per source with `transparent_background=true`,
appending `Robot model: A2.`, `Robot model: LG2.` or `Robot model: A1.`:

> Use case: background-extraction. Asset type: transparent PNG cutout for an interactive hardware diagnostic diagram. The input is the sole edit target, an exact CAD front view of a two-arm robot leader. Remove ONLY its pure white background, including the open space between the arms, gaps around every bracket, cable, bolt and handle, and openings within the mechanical structure. Output genuine alpha transparency, not white, black, checkerboard, or a painted background. Preserve the exact original CAD drawing, all geometry, proportions, front view, bilateral placement, dark grey materials, thin black outlines, highlights, fasteners, brackets, grippers/handles and central support. Do not redesign, simplify, add, remove or move any robot component. Keep the whole object visible with no clipping. Remove the excess empty margins and place the unchanged complete object at the center of a square 1024 by 1024 transparent canvas, uniformly scaled to occupy approximately 90 percent of the canvas height while retaining the original aspect ratio. No shadow, glow, halo, text, labels, or new objects. Edges should be clean and antialiased with no white fringe. Preserve solid robot surfaces as opaque.

The user's joint diagram defines follower IDs 1/31 shoulder pitch (inboard), 2/32 shoulder roll (outboard), 3/33 shoulder yaw, 4/34 elbow, 5/35 wrist yaw, 6/36 wrist pitch, 7/37 wrist roll, 8/38 gripper, 62 head yaw (above 61 head pitch), and 81 lift at the bottom of the column. The W2/SG2 Xacro confirms steering IDs 101 left, 103 right and 105 rear; those are selectable on the wheeled base. Virtual wheel-drive devices remain excluded from direct diagnosis. Additional discoveries are never positioned by ID alone.

## Editing prompts

The three steering markers share the same height (80% of the map). LED is below the right shoulder toward the center. IMU is centered above the RCU, which is below rear steering ID 105. These markers open the existing board details and are omitted from the lower tray to avoid duplicates; unknown additional discoveries remain in the tray.

### Transparent background (both final assets)

Use case: background-extraction. Asset type: transparent PNG cutout for an interactive robot diagnostic diagram. Input image is the sole edit target. Remove only the white background, including all white background openings between the arms and torso, within the grippers and between the feet or wheels. Return true alpha transparency, not a painted checkerboard or a solid color. Preserve all opaque robot surfaces, especially the WHITE chest shell and WHITE/silver head rim, which must stay opaque. Keep the robot exactly unchanged: same front view, full body, posture, proportions, outline, all joints, grippers, wheels or feet, lift column, base, lighting, texture, ROBOTIS logo and framing. The emergency stop button has already been removed; do not add it back. No new objects, no extra shadow, no glow, no labels, no redesign, no cropping or stretching. Preserve the source portrait aspect ratio and subject placement so existing clickable joint coordinates stay aligned.

### Fixed base

Use case: precise-object-edit.
Asset type: existing robot product photo used as a diagnostic UI diagram.
Input image: sole edit target.
Primary request: remove ONLY the tiny red emergency-stop button on the lower base. The small red emergency-stop button is on top of the lower rectangular base, right of the central vertical lift column, around x=339,y=703 in the 462x905 source.
Fill its former location with the matching plain white background and continue the existing straight black top edge of the base naturally where necessary.
Constraints: preserve the exact full robot, original front view, pose, joints, grippers, wheels or feet, proportions, framing, original pixel geometry, logo "ROBOTIS", white background, lighting, shading and original image sharpness. No retouching, redesign, new details, cropping, zoom, perspective change, or changes anywhere else. Keep the same portrait aspect ratio as the input. Output one edited version of this exact image.

### Wheeled base

Use case: precise-object-edit.
Asset type: existing robot product photo used as a diagnostic UI diagram.
Input image: sole edit target.
Primary request: remove ONLY the tiny red emergency-stop button on the lower base. The small red emergency-stop button is on top of the lower wheeled base, right of the central vertical lift column, around x=322,y=687 in the 462x905 source. Keep the two black raised fixtures on top of the base intact.
Fill its former location with the matching plain white background and continue the existing straight black top edge of the base naturally where necessary.
Constraints: preserve the exact full robot, original front view, pose, joints, grippers, wheels or feet, proportions, framing, original pixel geometry, logo "ROBOTIS", white background, lighting, shading and original image sharpness. No retouching, redesign, new details, cropping, zoom, perspective change, or changes anywhere else. Keep the same portrait aspect ratio as the input. Output one edited version of this exact image.


## Hand image and maps

### SH5 / BH5 whole-robot variants

Updated using the user's actual side-view photograph
`/tmp/codex-clipboard-ebaa1f81-7901-44e8-8f69-b2c42f98d6bc.png`.
The UI now retains the original robot artwork outside two gripper rectangles,
using SVG masking/clipping to show only the replacement hands from the edited
assets. Each hand region is mirrored independently so its thumb faces inward,
as corrected by the user. This preserves the original torso, arm joints, wrist adapters and base
pixels rather than relying on the image model to reproduce them exactly.

Current built-in image_gen prompt:

> Use case: precise-object-edit / compositing. IMAGE 1 is the ORIGINAL robot edit target. IMAGE 2 is the user's authoritative real photograph showing the EXACT SIDE PROFILE of the robotic hand. Replace ONLY the two claw grippers at the very ends of the arms of image 1 with hands that match the strictly EDGE-ON SIDE silhouette in image 2. Keep the original robot entirely unchanged outside those two gripper regions, including the existing narrow perforated wrist adapter above each claw. The replacement starts exactly where each old claw palm attaches at the end of the wrist. Preserve the exact head, torso, logo, every arm joint, wrist adapter, lift, base, wheels/feet, camera view, canvas aspect ratio, margins and original pixel placement. Do not regenerate or redesign the body. CRITICAL HAND SHAPE: use the real reference's long narrow smooth black side casing, small screws, side-on thumb linkage running parallel alongside the palm, and downward finger actuator chain with visible circular pivot covers. Four fingers overlap in depth in this edge-on view, appearing as a narrow stacked chain, NOT a broad palm or four fingers spread side by side. No glove-like hand and no fan of fingers. Hang vertically, fingers down, thumb facing inward toward the robot's center, mirrored left/right. Scale each whole hand wrist-to-tip to approximately 14 percent of robot total height; side profile width no more than existing wrist housing. Subtle neutral product-render lighting to match image 1. No room, people, furniture or background from image 2; reference supplies ONLY the hand geometry and side pose. Preserve genuine transparent alpha background and opaque white robot surfaces. Do not add emergency stop, labels, arrows or shadows on background. Full robot unchanged framing, no cropping, zoom or recentering.

Suffix per asset: Preserve the wheeled/fixed base of image 1 exactly.

Earlier generation notes:

The built-in image_gen tool composited hanging, inward-facing dexterous hands
onto the original wheeled and fixed-base robot images, using the cleaned hand
as a design reference. These illustrative side/three-quarter views are used
only for SH5 and BH5; all other profiles retain their existing artwork.
Both files preserve alpha transparency. RH/LH markers sit over the hand regions
and open the corresponding detailed hand map.

- `/home/gyu/ws/cyclo_manager/cyclo_manager_ui/public/diagnostics/ai-worker-sh5-transparent.png`
- `/home/gyu/ws/cyclo_manager/cyclo_manager_ui/public/diagnostics/ai-worker-bh5-transparent.png`

Shared final prompt (with the appropriate wheeled/fixed base preservation suffix):

> Use case: compositing. Image 1 is the EDIT TARGET, a full frontal robot with arms hanging down. Image 2 is ONLY a hand design reference. Replace ONLY the two claw grippers at the bottom ends of the arms in image 1 with properly attached black five-finger dexterous robot hands based on image 2. The hands must hang naturally fingers pointing DOWN, palms facing INWARD toward the central lift column, so we see a slim SIDE / three-quarter SIDE view of each hand, not their flat palms. Mirror left/right appropriately. Match black mechanical material, lighting and realistic scale: each complete hand from wrist to fingertip about 13 percent of full robot height, palm width comparable to forearm width. Join directly to existing wrist connector, no floating parts, no residual claw. Preserve everything else in image 1 precisely: head, torso, ROBOTIS logo, ALL arm joint positions and proportions, central lift column, BASE, wheels/feet, front camera and pose, canvas aspect ratio, transparent padding, full-body framing and original subject scale. Do not recenter, zoom or crop, because existing joint markers rely on original coordinates. True transparent alpha background; preserve opaque white torso and head rim. No labels, arrows, highlights, emergency stop, shadows on background or added objects. This is a clean UI illustration.

SH5 suffix: Output SH5 variant: keep the wheeled base of edit target unchanged.
BH5 suffix: Output BH5 variant: keep the rectangular fixed base and its feet of edit target unchanged.

### Detailed hand view

The supplied annotated right-hand image was edited with the built-in image_gen
 tool (`transparent_background=true`). The final asset is
`/home/gyu/ws/cyclo_manager/cyclo_manager_ui/public/diagnostics/hand-right-transparent.png`.
The left-hand view mirrors this illustration in SVG; it is not a separate CAD rendering.

Final prompt:

> Use case: background-extraction. Edit target: supplied annotated black robotic RIGHT hand image. Create a clean transparent cutout for a hardware diagnostics UI. Remove ALL text, labels, the white Hand Controller label rectangle, gray leader lines and circular annotation dots, colored coordinate axes, and white background. Reconstruct black mechanical surfaces underneath annotations. Preserve precisely the same hand shape, finger count, joint segments, black materials, pose, front view and thumb extending to the RIGHT; do not redesign or add parts. Entire hand including wrist visible. Center the hand on a transparent canvas with small even padding, hand nearly fills canvas. No text, no lines, no annotation dots, no ground shadow. Actual transparent alpha background.

SH5/BH5 show Robot, Right hand, and Left hand selectors when their configured
controllers are present. Robot overview markers summarize the controller and its
configured children, preserving unknown, pending, stale and error states. Each
hand map renders only configured child IDs and its controller, linking to the
existing device details. Initialization GPIO aliases of mapped motors are not
shown as additional boards. The source diagram includes passive fingertip labels;
these are not fabricated as diagnostic devices when absent from Xacro.
