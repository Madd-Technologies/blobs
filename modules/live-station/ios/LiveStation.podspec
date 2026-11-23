Pod::Spec.new do |s|
  s.name           = 'LiveStation'
  s.version        = '0.1.0'
  s.summary        = 'WidgetKit App Group snapshot sync and ActivityKit Live Activities for Blobs on iOS'
  s.license        = 'MIT'
  s.author         = 'Madd Technologies'
  s.homepage       = 'https://blobs.maddtechnologies.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Foundation'
  s.weak_frameworks = 'ActivityKit', 'WidgetKit'
  s.source_files = '**/*.swift'
end
