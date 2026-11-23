Pod::Spec.new do |s|
  s.name           = 'ApnsPush'
  s.version        = '0.1.0'
  s.summary        = 'iOS APNs device token and actionable notification categories for Blobs'
  s.license        = 'MIT'
  s.author         = 'Madd Technologies'
  s.homepage       = 'https://blobs.maddtechnologies.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'UserNotifications'
  s.source_files = '**/*.swift'
end
