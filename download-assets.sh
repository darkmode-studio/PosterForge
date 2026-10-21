#!/bin/bash
# Re-downloads the bundled offline libraries and fonts into app/src/main/assets (already included in the source).
set -euo pipefail
A="$(dirname "$0")/app/src/main/assets"; mkdir -p "$A/vendor" "$A/fonts"
curl -fsSL https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js -o "$A/vendor/fabric.min.js"
curl -fsSL https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js -o "$A/vendor/imagetracer.js"
curl -fsSL https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js -o "$A/vendor/opentype.min.js"
# Fonts: fetch sources into a temp dir, then build-fonts.py makes static Regular/Bold instances (opentype.js cannot
# read variable fonts), subsets them (Latin; + Malayalam for Malayalam fonts, all shaping features kept), writes
# fonts/fonts.json and one LICENSE-<Family>.txt per family. Needs: pip install fonttools
S=$(mktemp -d); G=https://raw.githubusercontent.com/google/fonts/main
get() { curl -fsSL "$G/$1" -o "$S/$(basename "$1" | sed 's/%5B/[/g; s/%5D/]/g; s/%2C/,/g')"; }
for p in ofl/montserrat/Montserrat%5Bwght%5D.ttf ofl/poppins/Poppins-Regular.ttf ofl/poppins/Poppins-Bold.ttf ofl/bebasneue/BebasNeue-Regular.ttf \
  ofl/manjari/Manjari-Regular.ttf ofl/manjari/Manjari-Bold.ttf ofl/chilanka/Chilanka-Regular.ttf \
  ofl/notoserifmalayalam/NotoSerifMalayalam%5Bwght%5D.ttf ofl/notosansmalayalam/NotoSansMalayalam%5Bwdth%2Cwght%5D.ttf \
  ofl/baloochettan2/BalooChettan2%5Bwght%5D.ttf ofl/anekmalayalam/AnekMalayalam%5Bwdth%2Cwght%5D.ttf ofl/gayathri/Gayathri-Regular.ttf ofl/gayathri/Gayathri-Bold.ttf \
  ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf \
  ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf ofl/lora/Lora%5Bwght%5D.ttf ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf ofl/oswald/Oswald%5Bwght%5D.ttf \
  ofl/anton/Anton-Regular.ttf ofl/archivoblack/ArchivoBlack-Regular.ttf ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf ofl/dancingscript/DancingScript%5Bwght%5D.ttf \
  ofl/greatvibes/GreatVibes-Regular.ttf ofl/caveat/Caveat%5Bwght%5D.ttf apache/permanentmarker/PermanentMarker-Regular.ttf; do get "$p"; done
python3 -m fontTools.varLib.instancer "$S/Montserrat[wght].ttf" wght=400 -o "$S/Montserrat-Regular.ttf" -q
python3 -m fontTools.varLib.instancer "$S/Montserrat[wght].ttf" wght=700 -o "$S/Montserrat-Bold.ttf" -q
for d in montserrat poppins bebasneue manjari chilanka; do curl -fsSL "$G/ofl/$d/OFL.txt" -o "$S/OFL-$d.txt"; done
for d in notosansmalayalam notoserifmalayalam baloochettan2 anekmalayalam gayathri playfairdisplay dmserifdisplay cormorantgaramond fraunces lora inter oswald anton archivoblack spacegrotesk dancingscript greatvibes caveat; do
  curl -fsSL "$G/ofl/$d/OFL.txt" -o "$S/LIC-$d.txt"; done
curl -fsSL "$G/apache/permanentmarker/LICENSE.txt" -o "$S/LIC-permanentmarker.txt"
# Swathanthra Malayalam Computing fonts (SIL OFL 1.1, licence stated in each font's name table)
for f in rachana/Rachana-Regular rachana/Rachana-Bold meera/Meera-Regular keraleeyam/Keraleeyam-Regular uroob/Uroob-Regular dyuthi/Dyuthi-Regular; do
  curl -fsSL "https://smc.org.in/downloads/fonts/$f.ttf" -o "$S/$(basename $f).ttf"; done
python3 "$(dirname "$0")/build-fonts.py" "$S" "$A/fonts"
rm -rf "$S"
echo "Assets updated."
