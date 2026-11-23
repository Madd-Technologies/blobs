Pod::Spec.new do |s|
  s.name           = 'ShareInbox'
  s.version        = '0.1.0'
  s.summary        = 'App Group share handoff module for Blobs iOS Share Extension'
  s.license        = 'MIT'
  s.author         = 'Madd Technologies'
  s.homepage       = 'https://blobs.maddtechnologies.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Foundation', 'UIKit'
  s.source_files = '**/*.swift'
end
