Pod::Spec.new do |s|
  s.name           = 'DuplexAudio'
  s.version        = '0.1.0'
  s.summary        = 'Full-duplex 24 kHz echo-cancelled call audio for Blobs'
  s.description    = 'Simultaneous voice-chat microphone capture and PCM16 playback at 24 kHz mono.'
  s.license        = 'MIT'
  s.author         = 'Madd Technologies'
  s.homepage       = 'https://blobs.maddtechnologies.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'UIKit'
  s.source_files = '**/*.swift'
end
