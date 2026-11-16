import bpy, math, os, json, subprocess
import shutil, sys
from pathlib import Path
from mathutils import Vector
ROOT=str(Path(__file__).resolve().parents[1])
# Blender may expose its own executable rather than a standalone Python.
# The texture optimizer needs a Python environment with Pillow installed.
PYTHON=os.environ.get('BLENDER_ASSET_PYTHON') or (sys.executable if Path(sys.executable).name.lower().startswith('python') else shutil.which('python3') or shutil.which('python'))
if not PYTHON:raise RuntimeError('Set BLENDER_ASSET_PYTHON to a Python interpreter with Pillow installed')
bpy.ops.wm.read_factory_settings(use_empty=True)
# Furniture origin at floor; Blender Z-up converts to glTF Y-up. Top is exactly .740m.
def material(name,color,roughness,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metal
 return m,p
def wood(name,polish):
 m,p=material(name,(.3,.17,.08),polish);nt=m.node_tree
 for kind,socket in [('diffuse','Base Color'),('rough','Roughness'),('nor_gl','Normal')]:
  im=bpy.data.images.load(ROOT+'/blender/tex/ph_walnut_'+kind+'.jpg',check_existing=True)
  if kind!='diffuse':im.colorspace_settings.name='Non-Color'
  im.pack();t=nt.nodes.new('ShaderNodeTexImage');t.image=im
  if kind=='nor_gl':
   nm=nt.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.16;nt.links.new(t.outputs['Color'],nm.inputs['Color']);nt.links.new(nm.outputs['Normal'],p.inputs[socket])
  elif kind=='rough':
   mult=nt.nodes.new('ShaderNodeMath');mult.operation='MULTIPLY';mult.inputs[1].default_value=polish;nt.links.new(t.outputs['Color'],mult.inputs[0]);nt.links.new(mult.outputs[0],p.inputs[socket])
  else:nt.links.new(t.outputs['Color'],p.inputs[socket])
 p.inputs['Coat Weight'].default_value=.32;p.inputs['Coat Roughness'].default_value=.19;p.inputs['Specular IOR Level'].default_value=.38
 return m
walnut,p=material('Nero marble • polished mineral slab',(1,1,1),.22)
im=bpy.data.images.load(ROOT+'/public/textures/nero-marble-v1.jpg',check_existing=True);im.pack()
t=walnut.node_tree.nodes.new('ShaderNodeTexImage');t.image=im
walnut.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
p.inputs['Coat Weight'].default_value=.45;p.inputs['Coat Roughness'].default_value=.12
p.inputs['Specular IOR Level'].default_value=.4
rimwood=wood('Walnut • oiled edge',.72)
brass,p=material('Brass • satin champagne',(.57,.36,.13),.28,.84)
base,p=material('Pedestal • charcoal bronze',(.035,.031,.027),.36,.65)
rubber,p=material('Floor pad • rubber',(.008,.01,.01),.92)
event,p=material('Event inlay • recessed opal channel',(.3,.19,.08),.28)
p.inputs['Emission Color'].default_value=(.8,.52,.22,1);p.inputs['Emission Strength'].default_value=.6
objects=[]
def finish(o,name,mat,smooth=True):
 o.name=name;o.data.materials.append(mat);objects.append(o)
 for poly in o.data.polygons:poly.use_smooth=smooth
 return o
def lathe(name,profile,mat,segments=128,flute=0):
 vs=[];fs=[]
 for r,z in profile:
  for j in range(segments):
   a=j*2*math.pi/segments;rr=r+(flute*math.cos(a*32) if r>.05 else 0);vs.append((rr*math.cos(a),rr*math.sin(a),z))
 for i in range(len(profile)-1):
  for j in range(segments):
   k=i*segments+j;l=i*segments+(j+1)%segments
   if profile[i][0]==0:fs.append((k,l+segments,k+segments))
   elif profile[i+1][0]==0:fs.append((k,l,k+segments))
   else:fs.append((k,l,l+segments,k+segments))
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o)
 uv=me.uv_layers.new(name='UVMap')
 for poly in me.polygons:
  for li in poly.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(v.x/1.44+.5,v.y/1.44+.5)
 return finish(o,name,mat)
lathe('Table_Walnut_Rim',[(.653,.701),(.711,.701),(.719,.709),(.72,.721),(.718,.735),(.711,.740),(.657,.740),(.653,.737),(.653,.701)],rimwood)
# Twelve radial bookmatched veneers; planar normals and radial UVs keep actual grain crisp.
vs=[];fs=[];uvs=[];N=12;S=12;radius=.654
for sector in range(N):
 mid=(sector+.5)*2*math.pi/N;first=len(vs);vs.append((0,0,.740));uvs.append((.5,.025))
 for j in range(S+1):
  a=(sector+j/S)*2*math.pi/N;x=radius*math.cos(a);y=radius*math.sin(a);vs.append((x,y,.740))
  cross=-x*math.sin(mid)+y*math.cos(mid);along=x*math.cos(mid)+y*math.sin(mid)
  u=.5+cross/(radius*.58);v=.025+along/radius*.95
  if sector%2:u=1-u
  uvs.append((u,v))
 for j in range(S):fs.append((first,first+j+1,first+j+2))
me=bpy.data.meshes.new('Bookmatched veneer');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('Table_Walnut_Surface',me);bpy.context.collection.objects.link(o);uv=me.uv_layers.new(name='UVMap')
for poly in me.polygons:
 for li in poly.loop_indices:v=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(v.x/1.308+.5,v.y/1.308+.5)
finish(o,'Table_Walnut_Surface',walnut,False)
lathe('Table_Brass_Inlay',[(.654,.7385),(.6565,.7385),(.6565,.7403),(.654,.7403),(.654,.7385)],brass)
lathe('Table_Brass_Edge',[(.719,.712),(.7208,.712),(.7208,.714),(.719,.714),(.719,.712)],brass)
lathe('Table_Glow_EventRing',[(.609,.7401),(.6102,.7401),(.6102,.74025),(.609,.74025),(.609,.7401)],event)
lathe('Table_Pedestal',[(0,.015),(.305,.015),(.323,.025),(.315,.045),(.275,.065),(.205,.10),(.145,.18),(.119,.28),(.115,.46),(.13,.57),(.18,.64),(.29,.69),(.31,.701),(0,.701)],base,128,.0005)
lathe('Table_Pedestal_Collar',[(.283,.683),(.307,.691),(.31,.699),(.289,.699),(.283,.683)],brass)
lathe('Table_Foot_Pad',[(0,.001),(.298,.001),(.304,.007),(.305,.015),(0,.015)],rubber,96)
root=bpy.data.objects.new('Table_Premium',None);bpy.context.collection.objects.link(root)
for o in objects:o.parent=root
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/blender/table-premium-marble.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/public/models/table-premium-marble.glb',export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
subprocess.run([PYTHON,ROOT+'/blender/optimize_glb_textures.py',ROOT+'/public/models/table-premium-marble.glb'],check=True)
print('TABLE_ASSET',json.dumps({'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),'parts':[o.name for o in objects],'bounds_m':[-.7208,0,-.7208,.7208,.7403,.7208],'bytes':os.path.getsize(ROOT+'/public/models/table-premium-marble.glb')}))
