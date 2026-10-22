# Recreates /tmp/pf2 font-import fixtures used by e2e_v2_on21.py (renamed copies of bundled OFL fonts).
import os, zipfile
from fontTools.ttLib import TTFont
F='/workspace/posterforge/PosterForge-Android/app/src/main/assets/fonts/'; O='/tmp/pf2/'; os.makedirs(O, exist_ok=True)
def mk(src, dst, fam, sub, weight, italic, panose_family=None):
    f=TTFont(F+src); n=f['name']
    for r in list(n.names):
        if r.nameID in (1,16): n.setName(fam, r.nameID, r.platformID, r.platEncID, r.langID)
        elif r.nameID in (2,17): n.setName(sub, r.nameID, r.platformID, r.platEncID, r.langID)
        elif r.nameID==4: n.setName(f'{fam} {sub}', 4, r.platformID, r.platEncID, r.langID)
        elif r.nameID==6: n.setName(f'{fam.replace(" ","")}-{sub.replace(" ","")}', 6, r.platformID, r.platEncID, r.langID)
    os2=f['OS/2']; os2.usWeightClass=weight
    os2.fsSelection=(os2.fsSelection & ~0x61) | (0x01 if italic else 0) | (0x20 if weight>=700 else 0) | (0x40 if (weight<700 and not italic) else 0)
    if panose_family is None and fam=='Test Sans':
        os2.panose.bFamilyType=2; os2.panose.bSerifStyle=11; os2.panose.bProportion=3
    f['head'].macStyle=(1 if weight>=700 else 0)|(2 if italic else 0)
    if panose_family is not None:
        for a in ('bFamilyType','bSerifStyle','bWeight','bProportion','bContrast','bStrokeVariation','bArmStyle','bLetterForm','bMidline','bXHeight'): setattr(os2.panose, a, 0)
        os2.sFamilyClass=0
    f.save(O+dst)
mk('Inter-400.ttf','TestSans-Regular.ttf','Test Sans','Regular',400,False)
mk('Inter-700.ttf','TestSans-Bold.ttf','Test Sans','Bold',700,False)
mk('Inter-400i.ttf','TestSans-Italic.ttf','Test Sans','Italic',400,True)
mk('AnekMalayalam-400.ttf','/tmp/pf2/m1.ttf'.split('/')[-1],'Test Mal','Regular',400,False)
mk('AnekMalayalam-700.ttf','m2.ttf','Test Mal','Bold',700,False)
with zipfile.ZipFile(O+'TestMal.zip','w') as z: z.write(O+'m1.ttf','TestMal-Regular.ttf'); z.write(O+'m2.ttf','TestMal-Bold.ttf')
mk('AbrilFatface-400.ttf','TestPlain.ttf','Test Plain','Regular',400,False,panose_family=0)
open(O+'notafont.ttf','wb').write(b'this is not a font file at all')
print('ok')
