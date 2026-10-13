# Test fixtures

- `gladys-feature-table.json`: the category/type couples the Gladys front-end
  can display, extracted from the Gladys core code (provided by the maintainer).
- `reported/roomba-980.json`: the full `state.reported` of a Roomba 980
  (firmware 2.0), as printed in the dorita980 README (MIT, Facu ZAK). Network
  identifiers replaced (documentation addresses, locally administered MACs,
  SSID "Example" in hex).
- `reported/roomba-i7.json`: an i7 (`lewis` firmware) composed from the Home
  Assistant `roomba` test fixture (Apache-2.0: `cap`, `cleanMissionStatus`,
  `dock`, `hwPartsRev`, `bin`, `signal`) and the keys roombapy (MIT) documents
  for the i/s family (`subModSwVer`, `cleanSchedule2`, `bbmssn`, `bbrun`,
  `pmaps`, `evacAllowed`). Serial numbers, map ids and MACs invented.
- `reported/braava-m6.json`: a Braava jet m6 (`sanmarino` firmware) composed
  from the keys Home Assistant reads for a Braava (`detectedPad`, `mopReady`,
  `tankLvl`, `padWetness`, `rankOverlap`). Values invented.
- `discovery/roomba-980.json`: the discovery answer of roombapy's tests (MIT),
  BLID, MAC and address replaced. `discovery/roomba-i7.json`: the same shape
  with the `iRobot-<BLID>` hostname of recent models.

No fixture comes from a robot of the author: the integration was developed
without the hardware.
