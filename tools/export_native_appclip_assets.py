#!/usr/bin/env python3
"""Export original LUX GLB mesh and Heartwood textures for native ARKit App Clip.

Leaves the original GLB untouched. Native renderer crops original triangles at
runtime, interpolating the existing authored UVs. There are no extra strips.
"""
from pathlib import Path
import json, shutil
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[1]
DST=ROOT/"native-appclip"/"Resources"
DST.mkdir(parents=True,exist_ok=True)
SOURCE=ROOT/"Profiles"/"V-GRROOVE_LAP.glb"
scene=trimesh.load(str(SOURCE),force="scene",process=False)
positions=[];uv=[];triangles=[]
for node in scene.graph.nodes_geometry:
    transform,meshname=scene.graph[node]
    mesh=scene.geometry[meshname]
    texcoords=getattr(mesh.visual,"uv",None)
    if texcoords is None:raise ValueError(f"No UV on {node}")
    verts=trimesh.transform_points(mesh.vertices,transform)
    offset=len(positions)
    positions.extend([[round(float(v),6) for v in p] for p in verts])
    uv.extend([[round(float(v),6) for v in p] for p in np.asarray(texcoords)])
    triangles.extend([[int(i)+offset for i in face] for face in mesh.faces])
    print("Included:",node,len(verts),"verts",len(mesh.faces),"faces")
assert len(triangles)>500 and len(positions)==len(uv)
mesh_data={"source":"Original LUX V-GRROOVE_LAP.glb (baked transforms, real metres)",
           "positions":positions,"uv":uv,"triangles":triangles}
(DST/"lap-mesh.json").write_text(json.dumps(mesh_data,separators=(",",":")))
shutil.copyfile(ROOT/"Textures"/"Heartwood"/"LAP HEARTWOOD.jpg",DST/"heartwood.jpg")
shutil.copyfile(ROOT/"Textures"/"Heartwood"/"TRIM HEARTWOOD.jpg",DST/"trim.jpg")
print("Native App Clip assets:",len(positions),"vertices,",len(triangles),"triangles; UV intact; textures untouched")
