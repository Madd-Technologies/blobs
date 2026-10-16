// The compositions `npm run capture:compose` renders. Default props point at the staged public folder the compose step
// writes (capture/out/store/.stage), so `npx remotion studio capture/compose/remotion/index.ts --public-dir
// capture/out/store/.stage` previews them after one compose run.

import { Composition, Still as StillComposition } from 'remotion'

import { FeatureGraphic } from './FeatureGraphic.tsx'
import { Preview } from './Preview.tsx'
import { Still } from './Still.tsx'
import { OUTPUTS, PREVIEW, timeline } from '../set.ts'

const iphoneShot = (name: string) => ({ src: `iphone/screenshots/dark/${name}.png`, width: 1320, height: 2868 })

export function Root() {
  const preview = OUTPUTS.appStorePreview

  return (
    <>
      <StillComposition id="AppStoreStill" component={Still} {...OUTPUTS.appStoreStill} defaultProps={{ frame: 0, platform: 'iphone', shot: iphoneShot('01-home') }} />
      <StillComposition id="AppStoreStill63" component={Still} {...OUTPUTS.appStoreStill63} defaultProps={{ frame: 0, platform: 'iphone', shot: iphoneShot('01-home') }} />
      <StillComposition
        id="PlayStill"
        component={Still}
        {...OUTPUTS.playStill}
        defaultProps={{ frame: 0, platform: 'android', shot: { src: 'android/screenshots/dark/01-home.png', width: 1440, height: 2560 } }}
      />
      <StillComposition id="FeatureGraphic" component={FeatureGraphic} {...OUTPUTS.featureGraphic} defaultProps={{ platform: 'iphone', shot: iphoneShot('12-courier-approval') }} />
      <Composition
        id="AppStorePreview"
        component={Preview}
        width={preview.width}
        height={preview.height}
        fps={preview.fps}
        durationInFrames={timeline(PREVIEW, preview.fps).total}
        defaultProps={{
          clips: Object.fromEntries(PREVIEW.map(segment => [segment.clip, { src: `iphone/clips/${segment.clip}.mp4`, width: 1320, height: 2868 }])),
        }}
      />
    </>
  )
}
