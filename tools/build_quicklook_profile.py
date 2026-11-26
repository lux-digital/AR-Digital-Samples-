#!/usr/bin/env python3
"""LUX Quick Look: real V-Groove/Lap GLB geometry, existing Heartwood textures.

Converts the original GLB mesh to true USD geometry with original authored UVs.
Crops triangles in model space into a central visible window and four separately
revealable edge strips. Rotates the original XY plane to XZ so +Y is the wall
surface normal under Apple's vertical plane anchor.

AR Quick Look action support is device-dependent; two exports isolate the
geometry+wall anchor from the in-scene tap action experiment.
"""
from pathlib import Path
import math
import re
import struct
import sys
import zipfile

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "quicklook"
OUT.mkdir(exist_ok=True)
PROFILE = ROOT / "Profiles/V-GRROOVE_LAP.glb"
WOOD = ROOT / "Textures/Heartwood/LAP HEARTWOOD.jpg"
TRIM = ROOT / "Textures/Heartwood/TRIM HEARTWOOD.jpg"
B = "/LUXRealLap"
CORE = (-0.80, -0.55, 0.80, 0.55)
STEP = 0.36
BANDS = {
    "Left": (CORE[0] - STEP, CORE[1], CORE[0], CORE[3]),
    "Right": (CORE[2], CORE[1], CORE[2] + STEP, CORE[3]),
    "Top": (CORE[0], CORE[3], CORE[2], CORE[3] + STEP),
    "Bottom": (CORE[0], CORE[1] - STEP, CORE[2], CORE[1]),
}

def num(v):
    f = float(v)
    if not math.isfinite(f):
        raise ValueError("Non-finite geometry")
    return format(0 if abs(f) < 1e-9 else f, ".6f").rstrip("0").rstrip(".") or "0"

def triple(a):
    return "(" + ", ".join(num(x) for x in a) + ")"

def bracket(rows):
    return "[" + ", ".join(rows) + "]"

def load_original():
    scene = trimesh.load(str(PROFILE), force="scene", process=False)
    parts = []
    for node in scene.graph.nodes_geometry:
        transform, key = scene.graph[node]
        mesh = scene.geometry[key]
        if len(mesh.faces) < 1:
            continue
        uv = getattr(mesh.visual, "uv", None)
        if uv is None or len(uv) != len(mesh.vertices):
            raise RuntimeError(f"Original GLB node {node} lacks vertex UVs")
        xyz = trimesh.transform_points(np.asarray(mesh.vertices, dtype=float), transform)
        uv = np.asarray(uv, dtype=float)
        if not np.isfinite(xyz).all() or not np.isfinite(uv).all():
            raise RuntimeError("Non-finite GLB attributes")
        parts.append((xyz, uv, np.asarray(mesh.faces, dtype=int)))
        print("Source GLB", node, "verts", len(xyz), "faces", len(mesh.faces),
              "bounds", np.min(xyz,axis=0).tolist(), np.max(xyz,axis=0).tolist(),
              "UV", np.min(uv,axis=0).tolist(), np.max(uv,axis=0).tolist())
    if not parts:
        raise RuntimeError("No mesh in original V-Groove/Lap GLB")
    return parts

def inside(p,axis,value,keep_high):
    return p[axis] >= value-1e-7 if keep_high else p[axis] <= value+1e-7

def slice_poly(poly, axis, value, keep_high):
    if not poly:
        return []
    result=[]
    prior=poly[-1]
    prior_in=inside(prior,axis,value,keep_high)
    for curr in poly:
        curr_in=inside(curr,axis,value,keep_high)
        if curr_in != prior_in:
            denominator=curr[axis]-prior[axis]
            t=max(0.0,min(1.0,(value-prior[axis])/denominator)) if abs(denominator)>1e-12 else 0.0
            result.append(prior+(curr-prior)*t)
        if curr_in:
            result.append(curr)
        prior,prior_in=curr,curr_in
    return result

def crop_tri(tri,rect):
    a,b,c,d=rect
    poly=list(tri)
    for axis,value,high in [(0,a,True),(0,c,False),(1,b,True),(1,d,False)]:
        poly=slice_poly(poly,axis,value,high)
        if len(poly)<3:
            return []
    return [[poly[0],poly[i],poly[i+1]] for i in range(1,len(poly)-1)]

def clipped_mesh(name,original,rect,mat):
    points=[]; st=[]; normals=[]
    for xyz,uv,faces in original:
        for face in faces:
            tri=[np.concatenate((xyz[idx],uv[idx])) for idx in face]
            for polygon in crop_tri(tri,rect):
                world=[]
                for p in polygon:
                    # Original GLB XY face -> vertical-anchored USD XZ plane.
                    # +Z original front becomes +Y in USD: Rx(-90 degrees).
                    world.append((float(p[0]),float(p[2])+.03,-float(p[1])))
                va=np.array(world[1])-world[0]
                vb=np.array(world[2])-world[0]
                n=np.cross(va,vb)
                ln=np.linalg.norm(n)
                if ln<1e-10:
                    continue
                normal=tuple((n/ln).tolist())
                points.extend(world)
                st.extend((float(p[3]),float(p[4])) for p in polygon)
                normals.extend([normal]*3)
    if len(points)<3:
        raise RuntimeError(f"GLB crop {name} empty; ensure geometry spans {rect}")
    ntris=len(points)//3
    print("USD surface", name, "triangles", ntris, "UV retained")
    return f'''def Mesh "{name}"
{{
    uniform bool doubleSided = true
    uniform token subdivisionScheme = "none"
    int[] faceVertexCounts = {bracket(["3"]*ntris)}
    int[] faceVertexIndices = {bracket([str(i) for i in range(len(points))])}
    point3f[] points = {bracket([triple(p) for p in points])}
    normal3f[] normals = {bracket([triple(n) for n in normals])} (
        interpolation = "faceVarying"
    )
    texCoord2f[] primvars:st = {bracket([triple(q) for q in st])} (
        interpolation = "faceVarying"
    )
    rel material:binding = <{B}/Materials/{mat}>
}}
'''

def face(name,rect,height,material="Trim",visibility=""):
    # Simple trim and corner pieces, following the profile edge on the wall.
    x0,y0,x1,y1=rect
    p=[(x0,height,-y0),(x1,height,-y0),(x1,height,-y1),(x0,height,-y1)]
    uv=[(0,0),(1,0),(1,1),(0,1)]
    return f'''def Mesh "{name}"
{{
    {('token visibility = "'+visibility+'"') if visibility else ''}
    uniform bool doubleSided = true
    uniform token subdivisionScheme = "none"
    int[] faceVertexCounts = [4]
    int[] faceVertexIndices = [0,1,2,3]
    point3f[] points = {bracket([triple(q) for q in p])}
    texCoord2f[] primvars:st = {bracket([triple(q) for q in uv])} (
        interpolation = "faceVarying"
    )
    rel material:binding = <{B}/Materials/{material}>
}}
'''

def cube(name,pos,extent,color):
    return f'''def Cube "{name}"
{{
    double size = 1
    double3 xformOp:translate = {triple(pos)}
    double3 xformOp:scale = {triple(extent)}
    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
    color3f[] primvars:displayColor = [{triple(color)}] (
       interpolation = "constant"
    )
}}
'''

def material(name,jpg,roughness):
    return f'''def Material "{name}"
{{
    token outputs:surface.connect = <{B}/Materials/{name}/Surface.outputs:surface>
    def Shader "Surface"
    {{
        uniform token info:id = "UsdPreviewSurface"
        color3f inputs:diffuseColor.connect = <{B}/Materials/{name}/Texture.outputs:rgb>
        float inputs:roughness = {num(roughness)}
        float inputs:metallic = 0.04
        token outputs:surface
    }}
    def Shader "Texture"
    {{
        uniform token info:id = "UsdUVTexture"
        asset inputs:file = @{jpg}@
        token inputs:sourceColorSpace = "sRGB"
        float2 inputs:st.connect = <{B}/Materials/{name}/ST.outputs:result>
        float3 outputs:rgb
    }}
    def Shader "ST"
    {{
        uniform token info:id = "UsdPrimvarReader_float2"
        token inputs:varname = "st"
        float2 outputs:result
    }}
}}
'''

def trim_edges(rect):
    a,b,c,d=rect
    t=.0254
    return {
      "Left":(a,b,a+t,d),
      "Right":(c-t,b,c,d),
      "Top":(a,d-t,c,d),
      "Bottom":(a,b,c,b+t)
    }

def action(name,objects):
    # Based on Apple's Preliminary_Behavior and the published USD exporter
    # representation of a VisibilityAction. The tap response first flips the
    # touched 3D handle, to help diagnose whether the trigger runs at all.
    return f'''def Preliminary_Behavior "Expand{name}"
{{
    rel triggers = [<Tap>]
    rel actions = [<Entry>]
    def Preliminary_Trigger "Tap" (
        inherits = </TapGestureTrigger>
    )
    {{
        rel affectedObjects = [<{B}/Controls/Handle{name}>]
    }}
    def Preliminary_Action "Entry" (
        inherits = </GroupAction>
    )
    {{
        uniform token type = "parallel"
        rel actions = [<Feedback>,<ShowBand>,<HideTrim>,<ShowTrim>]
    }}
    def Preliminary_Action "Feedback" (
        inherits = </EmphasizeAction>
    )
    {{
        rel affectedObjects = [<{B}/Controls/Handle{name}>]
        uniform token motionType = "flip"
        double duration = 0.45
    }}
    def Preliminary_Action "ShowBand" (
        inherits = </VisibilityAction>
    )
    {{
        rel affectedObjects = [<{B}/Sample/Band{name}>]
        uniform token info:id = "Visibility"
        uniform token type = "show"
        uniform token motionType = "none"
        uniform token style = "basic"
        double duration = 0.16
    }}
    def Preliminary_Action "HideTrim" (
        inherits = </VisibilityAction>
    )
    {{
        rel affectedObjects = [<{B}/Sample/Trim{name}>]
        uniform token info:id = "Visibility"
        uniform token type = "hide"
        uniform token motionType = "none"
        uniform token style = "basic"
        double duration = 0.16
    }}
    def Preliminary_Action "ShowTrim" (
        inherits = </VisibilityAction>
    )
    {{
        rel affectedObjects = [<{B}/Sample/Trim{name}Expanded>]
        uniform token info:id = "Visibility"
        uniform token type = "show"
        uniform token motionType = "none"
        uniform token style = "basic"
        double duration = 0.16
    }}
}}
'''

def usd_scene(original,interactive):
    name="LUXRealLap"
    text=f'''#usda 1.0
(
    defaultPrim = "{name}"
    metersPerUnit = 1
    upAxis = "Y"
)
def Xform "{name}" (
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{{
    uniform token preliminary:anchoring:type = "plane"
    uniform token preliminary:planeAnchoring:alignment = "vertical"
    def Scope "Materials"
    {{
{material("Wood","wood.jpg",.81)}
{material("Trim","trim.jpg",.65)}
    }}
    def Xform "Sample"
    {{
'''
    text+=clipped_mesh("Core",original,CORE,"Wood")
    for side,rect in BANDS.items():
        surface=clipped_mesh("Face",original,rect,"Wood")
        text+=f'def Xform "Band{side}"'+' {\n'
        if interactive:
            text+='token visibility = "invisible"\n'
        text+=surface+'}\n'
    old=trim_edges(CORE)
    for side,rect in old.items():
        text+=face("Trim"+side,rect,.061)
        new_rect=trim_edges({
            "Left":(CORE[0]-STEP,CORE[1],CORE[2],CORE[3]),
            "Right":(CORE[0],CORE[1],CORE[2]+STEP,CORE[3]),
            "Top":(CORE[0],CORE[1],CORE[2],CORE[3]+STEP),
            "Bottom":(CORE[0],CORE[1]-STEP,CORE[2],CORE[3]),
        }[side])[side]
        text+=face("Trim"+side+"Expanded",new_rect,.062,visibility="invisible" if interactive else "")
    text+='}\n'
    if interactive:
        text+='def Xform "Controls" {\n'
        markers={
            "Left":(CORE[0]-.10,0),
            "Right":(CORE[2]+.10,0),
            "Top":(0,CORE[3]+.10),
            "Bottom":(0,CORE[1]-.10),
        }
        for side,(x,y) in markers.items():
            text+=cube("Handle"+side,(x,.095,-y),(.13,.035,.13),(.98,.98,.92))
        text+='}\n'
    text+='}\n'
    if interactive:
        for side in BANDS:
            text+=action(side,None)
    return text

def pack_usdz(path, files):
    import zlib
    with zipfile.ZipFile(path, "w", allowZip64=False) as z:
        for filename,data in files:
            name=filename.encode("utf-8")
            padding=(-(z.fp.tell()+30+len(name)+4))%64
            info=zipfile.ZipInfo(filename)
            info.compress_type=zipfile.ZIP_STORED
            info.extra=struct.pack("<HH",0x1986,padding)+b"\0"*padding
            z.writestr(info,data)
    with zipfile.ZipFile(path,"r") as z:
        assert z.testzip() is None
        assert z.namelist()[0]=="scene.usda"
        for item in z.infolist():
            with open(path,"rb") as f:
                f.seek(item.header_offset+26)
                ln,ex=struct.unpack("<HH",f.read(4))
            assert (item.header_offset+30+ln+ex)%64==0,item.filename
            assert item.compress_type==zipfile.ZIP_STORED
    return path

def main():
    original=load_original()
    jpg=WOOD.read_bytes()
    trim=TRIM.read_bytes()
    assert jpg[:2]==b"\xff\xd8" and trim[:2]==b"\xff\xd8"
    for interactive,filename in [
        (False,"lux-real-lap-wall.usdz"),
        (True,"lux-real-lap-resize.usdz"),
    ]:
        usda=usd_scene(original,interactive)
        assert usda.count("def Mesh")>=9 and ("def Preliminary_Behavior" in usda)==interactive
        out=pack_usdz(OUT/filename,[
           ("scene.usda",usda.encode("utf-8")),
           ("wood.jpg",jpg),
           ("trim.jpg",trim)
        ])
        print("Built",out,"bytes",out.stat().st_size, "behaviors",usda.count("def Preliminary_Behavior"))
if __name__=="__main__":
    main()
