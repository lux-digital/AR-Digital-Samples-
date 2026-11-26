#!/usr/bin/env python3
"""Single complete LUX GLB + movable visible matte: Quick Look control feasibility.

Unlike the earlier cut-strip prototype, all original mesh vertices/UVs are
retained in a single mesh. The grey matte is deliberately OPAQUE, not a claim
that Apple Quick Look supports RealityKit OcclusionMaterial through USDZ.
"""
from pathlib import Path
import sys
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_quicklook_profile import load_original, clipped_mesh, material, cube, pack_usdz, B as OLD_B
from build_quicklook_profile import triple
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "quicklook"
WOOD = (ROOT / "Textures/Heartwood/LAP HEARTWOOD.jpg").read_bytes()
TRIM = (ROOT / "Textures/Heartwood/TRIM HEARTWOOD.jpg").read_bytes()
assert WOOD[:2] == TRIM[:2] == b"\xff\xd8"
# Existing exporter methods refer to B='/LUXRealLap', reuse the same name.
B = "/LUXRealLap"
START_WIDTH = (0.80,1.40,2.00)
SHIFT = .60
FULL = (-5.72446,-2.93751,5.72446,2.93751)

def slab_mesh(name,x0,x1,z0,z1,depth=.089,material_name="Mask",color=False):
    p=[(x0,depth,z0),(x1,depth,z0),(x1,depth,z1),(x0,depth,z1)]
    pts=", ".join(triple(t) for t in p)
    return f'''def Mesh "{name}"
{{
    uniform bool doubleSided = true
    uniform token subdivisionScheme = "none"
    int[] faceVertexCounts = [4]
    int[] faceVertexIndices = [0,1,2,3]
    point3f[] points = [{pts}]
    rel material:binding = <{B}/Materials/{material_name}>
}}
'''

def plain_mat(name,rgb,opacity=1.0):
    return f'''def Material "{name}"
{{
    token outputs:surface.connect = <{B}/Materials/{name}/PBR.outputs:surface>
    def Shader "PBR"
    {{
        uniform token info:id = "UsdPreviewSurface"
        color3f inputs:diffuseColor = {triple(rgb)}
        float inputs:roughness = 0.9
        float inputs:opacity = {opacity}
        token outputs:surface
    }}
}}
'''

def mask_xform(name,slab,trim=None,offset=0.0,button=None):
    group=f'''def Xform "{name}"
{{
    double3 xformOp:translate = {triple((offset,0,0))}
    uniform token[] xformOpOrder = ["xformOp:translate"]
'''
    group+=slab
    if trim:group+=trim
    if button:group+=button
    return group+"}\n"

def scene_usd(original,visible_right):
    mesh = clipped_mesh("FullOriginalGLB",original,FULL,"Wood")
    x=visible_right
    a=f'''#usda 1.0
(
 defaultPrim = "LUXRealLap"
 metersPerUnit = 1
 upAxis = "Y"
)
def Xform "LUXRealLap" (
 prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{{
 uniform token preliminary:anchoring:type = "plane"
 uniform token preliminary:planeAnchoring:alignment = "vertical"
 def Scope "Materials" {{
{material("Wood","wood.jpg",.81)}
{material("Trim","trim.jpg",.65)}
{plain_mat("Mask",(.53,.57,.54))}
{plain_mat("Handle",(.97,.97,.93))}
 }}
 def Xform "OriginalProduct" {{
 {mesh}
 }}
 def Xform "Masks" {{
'''
    # Left, upper and lower masks permanently cover everything outside
    # the 1.6m x1.1m starting window; no cross shaped geometry.
    a+=mask_xform("Left",slab_mesh("Matte",-6.0,-.8,-3.1,3.1))
    a+=mask_xform("Upper",slab_mesh("Matte",-6,6,.55,3.1))
    a+=mask_xform("Lower",slab_mesh("Matte",-6,6,-3.1,-.55))
    # Right is a single moving parent containing visible matte, right trim
    # and a physical button. The animation only translates this mask, not the GLB.
    # Local coords are authored relative to the CURRENT right-edge position.
    # TransformAction target will add +0.60 metres in model X.
    right=slab_mesh("Matte",0,6.3,-3.1,3.1)
    trim=slab_mesh("EdgeTrim",-.025,.0,-.55,.55,.108,"Trim")
    button=cube("Handle",(-.08,.18,0),(.13,.08,.15),(.97,.97,.91))
    a+=mask_xform("Right",right,trim,offset=x,button=button)
    a+='}\n'
    a+=f'''def Xform "Targets"
 {{
   def Xform "NextRight"
   {{
     double3 xformOp:translate = {triple((x+SHIFT,0,0))}
     uniform token[] xformOpOrder = ["xformOp:translate"]
   }}
 }}
'''
    # Close the default prim first: Apple's official tap example declares
    # Preliminary_Behavior at the USD scene ROOT, not inside the model prim.
    a += '}\n'
    # A tap on the physical button should animate the same mask 60cm outward.
    # Valid TransformAction schema: xformTarget relationship to a prim carrying
    # xformOp:translate, and affectedObjects pointing to moving parent.
    a+=f'''def Preliminary_Behavior "TapMoveRightMask"
 {{
   rel triggers = [<Tap>]
   rel actions = [<Entry>]
   def Preliminary_Trigger "Tap" (
      inherits = </TapGestureTrigger>
   )
   {{
      rel affectedObjects = [<{B}/Masks/Right/Handle>]
   }}
   def Preliminary_Action "Entry" (
      inherits = </GroupAction>
   )
   {{
      uniform token type = "parallel"
      rel actions = [<Move>]
   }}
   def Preliminary_Action "Move" (
      inherits = </TransformAction>
   )
   {{
      rel affectedObjects = [<{B}/Masks/Right>]
      rel xformTarget = [<{B}/Targets/NextRight>]
      double duration = 0.8
      uniform token easeType = "easeInOut"
   }}
 }}
'''
    return a

def main():
    original=load_original()
    for i,x in enumerate(START_WIDTH):
        usda=scene_usd(original,x)
        assert usda.count("def Mesh")==6 # full product, 4 mattes and 1 trim
        fn=OUT/f"lux-mask-test-{i}.usdz"
        pack_usdz(fn,[("scene.usda",usda.encode("utf-8")),("wood.jpg",WOOD),("trim.jpg",TRIM)])
        print("BUILT",fn,"size",fn.stat().st_size,"right",x)
if __name__=="__main__":
    main()
