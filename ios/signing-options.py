"""Validate an Ad Hoc HealthKit profile and prepare the export options."""
import os
import pathlib
import plistlib
import shutil
import datetime

temp = pathlib.Path(os.environ['RUNNER_TEMP'])
profile = plistlib.loads((temp / 'profile.plist').read_bytes())
team = os.environ['TEAM']
bundle = 'com.saud.refereecoach'
assert team in profile['TeamIdentifier'], 'Profile team does not match IOS_TEAM_ID'
assert profile.get('ProvisionedDevices'), 'Profile must include registered iPhone devices'
assert not profile.get('ProvisionsAllDevices'), 'Use an Ad Hoc profile'
assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), 'Profile expired'
ent = profile['Entitlements']
assert not ent.get('get-task-allow'), 'Use distribution, not development signing'
assert ent.get('com.apple.developer.healthkit') is True, 'Enable HealthKit in the App ID and regenerate the profile'
assert ent['application-identifier'].endswith('.' + bundle), 'Profile must match com.saud.refereecoach'
uuid = profile['UUID']
dest = pathlib.Path.home() / 'Library/MobileDevice/Provisioning Profiles'
dest.mkdir(parents=True, exist_ok=True)
shutil.copyfile(temp / 'profile.mobileprovision', dest / (uuid + '.mobileprovision'))
(temp / 'export.plist').write_bytes(plistlib.dumps({'method': 'release-testing', 'teamID': team, 'signingStyle': 'manual', 'signingCertificate': 'Apple Distribution', 'provisioningProfiles': {bundle: uuid}}))
with open(os.environ['GITHUB_ENV'], 'a') as output:
    output.write('PROFILE_UUID=' + uuid + '\n')
