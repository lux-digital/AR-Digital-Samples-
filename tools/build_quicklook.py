#!/usr/bin/env python3
"""Build two self-contained static USDZ files using existing LUX Heartwood texture.

No Mac or proprietary conversion service required. This script writes uncompressed
ZIP with 64-byte-aligned payloads per OpenUSD spec. Results require iPhone testing
for Apple Quick Look rendering and interactions.
"""
from pathlib import Path
import struct
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "quicklook"
OUT.mkdir(exist_ok=True)
TEXTURE = ROOT / "Textures" / "Heartwood" / "LAP HEARTWOOD.jpg"

def pack_usdz(path, files):
    """Stored ZIP members, no encryption, data payloads start on 64-byte boundaries."""
    with zipfile.ZipFile(path, "w", allowZip64=False) as z:
        for filename, data in files:
            name = filename.encode("utf-8")
            # The info.extra is repeated in central directory, which is allowed.
            # 4 bytes are the padding field's own header.
            pad = (-(z.fp.tell() + 30 + len(name) + 4)) % 64
            info = zipfile.ZipInfo(filename)
            info.compress_type = zipfile.ZIP_STORED
            info.extra = struct.pack("<HH", 0x1986, pad) + b"\0" * pad
            z.writestr(info, data)
    with zipfile.ZipFile(path, "r") as z:
        for info in z.infolist():
            # zipfile's header_offset points to the local file header.
            with open(path, "rb") as f:
                f.seek(info.header_offset)
                h = f.read(30)
            name_len, extra_len = struct.unpack_from("<HH", h, 26)
            payload = info.header_offset + 30 + name_len + extra_len
            assert payload % 64 == 0, (info.filename, payload)
            assert info.compress_type == zipfile.ZIP_STORED
            assert (zlib.crc32(z.read(info.filename)) & 0xffffffff) == info.CRC
        assert z.testzip() is None

SMOKE = """#usda 1.0
(
    defaultPrim = "LUXProbe"
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "LUXProbe" (
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{
    uniform token preliminary:anchoring:type = "plane"
    uniform token preliminary:planeAnchoring:alignment = "vertical"
    def Cube "VisibleCube"
    {
        double size = 0.5
        color3f[] primvars:displayColor = [(0.8, 0.15, 0.2)] (
            interpolation = "constant"
        )
    }
}
"""

def coords(v):
    return ", ".join(format(float(x), ".6g") for x in v)

def mesh(name, rect, material, z=0.0):
    x0,y0,x1,y1 = rect
    pts=[(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)]
    # The source image describes one continuous 25 x 4-foot panel.
    uv=[((x+3.81)/7.62,(y+0.6096)/1.2192) for x,y,_ in pts]
    def values(v):return ", ".join("("+coords(x)+")" for x in v)
    return f'''def Mesh "{name}"
{{
    int[] faceVertexCounts = [4]
    int[] faceVertexIndices = [0,1,2,3]
    point3f[] points = [{values(pts)}]
    normal3f[] normals = [(0,0,1)] (
        interpolation = "constant"
    )
    texCoord2f[] primvars:st = [{values(uv)}] (
        interpolation = "faceVarying"
    )
    uniform bool doubleSided = true
    uniform token subdivisionScheme = "none"
    rel material:binding = </LUXHeartwood/Materials/{material}>
}}
'''

def box(name,pos,scale,color):
    x,y,z=pos;sx,sy,sz=scale
    return f'''def Cube "{name}"
{{
    double size = 1
    double3 xformOp:translate = ({coords((x,y,z))})
    double3 xformOp:scale = ({coords((sx,sy,sz))})
    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
    color3f[] primvars:displayColor = [({coords(color)})] (interpolation = "constant")
}}
'''

def behavior(name, target, band, old_edge, new_edge):
    # Includes a visible 'flip' feedback to distinguish a working trigger from
    # any failure of the visibility action. Action IDs follow Apple's USD docs.
    return f'''def Preliminary_Behavior "Tap{name}"
{{
    rel triggers = [<Tap>]
    rel actions = [<Feedback>,<Reveal>,<HideOld>,<ShowNew>]
    def Preliminary_Trigger "Tap" (
        inherits = </TapGestureTrigger>
    )
    {{
        rel affectedObjects = [</LUXHeartwood/Controls/Handle{name}>]
    }}
    def Preliminary_Action "Feedback" (
        inherits = </EmphasizeAction>
    )
    {{
        uniform token motionType = "flip"
        rel affectedObjects = [</LUXHeartwood/Controls/Handle{name}>]
    }}
    def Preliminary_Action "Reveal" (
        inherits = </VisibilityAction>
    )
    {{
        uniform token type = "show"
        rel affectedObjects = [</LUXHeartwood/Sample/{band}>]
    }}
    def Preliminary_Action "HideOld" (
        inherits = </VisibilityAction>
    )
    {{
        uniform token type = "hide"
        rel affectedObjects = [</LUXHeartwood/Sample/{old_edge}>]
    }}
    def Preliminary_Action "ShowNew" (
        inherits = </VisibilityAction>
    )
    {{
        uniform token type = "show"
        rel affectedObjects = [</LUXHeartwood/Sample/{new_edge}>]
    }}
}}
'''

def interactive_scene():
    a='''#usda 1.0
(
    defaultPrim = "LUXHeartwood"
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "LUXHeartwood" (
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{
    uniform token preliminary:anchoring:type = "plane"
    uniform token preliminary:planeAnchoring:alignment = "vertical"
    def Scope "Materials"
    {
        def Material "Heartwood"
        {
            token outputs:surface.connect = </LUXHeartwood/Materials/Heartwood/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </LUXHeartwood/Materials/Heartwood/Image.outputs:rgb>
                float inputs:roughness = 0.85
                token outputs:surface
            }
            def Shader "Image"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @heartwood.jpg@
                token inputs:sourceColorSpace = "sRGB"
                float2 inputs:st.connect = </LUXHeartwood/Materials/Heartwood/ST.outputs:result>
                float3 outputs:rgb
            }
            def Shader "ST"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                token inputs:varname = "st"
                float2 outputs:result
            }
        }
        def Material "Trim"
        {
            token outputs:surface.connect = </LUXHeartwood/Materials/Trim/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.18,0.14,0.12)
                float inputs:roughness = 0.7
                token outputs:surface
            }
        }
    }
    def Xform "Sample"
    {
'''
    w,h,dx,dy=.77,.43,.26,.17
    a+=mesh("Center",(-w,-h,w,h),"Heartwood",0.0)
    regions={
        "Top":(-w,h,w,h+dy),
        "Bottom":(-w,-h-dy,w,-h),
        "Left":(-w-dx,-h,-w,h),
        "Right":(w,-h,w+dx,h),
    }
    trims={
        "Top":((-w,h-.016,w,h+.016),(-w,h+dy-.016,w,h+dy+.016)),
        "Bottom":((-w,-h-.016,w,-h+.016),(-w,-h-dy-.016,w,-h-dy+.016)),
        "Left":((-w-.016,-h,-w+.016,h),(-w-dx-.016,-h,-w-dx+.016,h)),
        "Right":((w-.016,-h,w+.016,h),(w+dx-.016,-h,w+dx+.016,h)),
    }
    for name,region in regions.items():
        # Initially invisible; action will attempt to show. This tests support.
        a+=f'def Xform "Band{name}" {{\n    token visibility = "invisible"\n'
        a+=mesh("Face",region,"Heartwood",.006)+"}\n"
        orig,expanded=trims[name]
        a+=f'def Xform "Trim{name}" {{\n'+mesh("Face",orig,"Trim",.023)+"}\n"
        a+=f'def Xform "Trim{name}Expanded" {{\n    token visibility = "invisible"\n'+mesh("Face",expanded,"Trim",.024)+"}\n"
    a+="}\n    def Xform \"Controls\"\n    {\n"
    handles={
        "Top":(0,h+.12,.08,.08,.025),
        "Bottom":(0,-h-.12,.08,.08,.025),
        "Left":(-w-.14,0,.08,.08,.025),
        "Right":(w+.14,0,.08,.08,.025)
    }
    for name,(x,y,sx,sy,sz) in handles.items():
        a+=box("Handle"+name,(x,y,.08),(sx,sy,sz),(.96,.95,.91))
    a+="}\n    def Xform \"Behaviors\"\n    {\n"
    for name in handles:
        a+=behavior(name,"Handle"+name,"Band"+name,"Trim"+name,"Trim"+name+"Expanded")
    a+="}\n}\n"
    return a

def main():
    smoke=OUT/"lux-quicklook-smoke.usdz"
    real=OUT/"lux-heartwood-interactive.usdz"
    pack_usdz(smoke,[("scene.usda",SMOKE.encode("utf-8"))])
    jpeg=TEXTURE.read_bytes()
    assert jpeg[:2] == b"\xff\xd8", "Source is not JPG"
    pack_usdz(real,[("scene.usda",interactive_scene().encode("utf-8")),("heartwood.jpg",jpeg)])
    print(f"Built {smoke}: {smoke.stat().st_size} bytes")
    print(f"Built {real}: {real.stat().st_size} bytes")
if __name__ == "__main__":
    main()
