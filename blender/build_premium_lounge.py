import bpy, json, math, struct, os, subprocess
import shutil, sys
from pathlib import Path
from mathutils import Vector
ROOT=str(Path(__file__).resolve().parents[1])
# Blender may expose its own executable rather than a standalone Python.
# The texture optimizer needs a Python environment with Pillow installed.
PYTHON=os.environ.get('BLENDER_ASSET_PYTHON') or (sys.executable if Path(sys.executable).name.lower().startswith('python') else shutil.which('python3') or shutil.which('python'))
if not PYTHON:raise RuntimeError('Set BLENDER_ASSET_PYTHON to a Python interpreter with Pillow installed')
bpy.ops.wm.open_mainfile(filepath=ROOT+'/blender/chaos-lounge.blend')
# Preserve the original 68-node export exactly, including the second baked-light UV set.
b=open(ROOT+'/public/models/lounge2.glb','rb').read();n=struct.unpack_from('<I',b,12)[0];old=json.loads(b[20:20+n]);names={x['name'] for x in old['nodes']}
def surface(name,prefix,roughness,normalstrength,coat):
 m=bpy.data.materials[name];m.use_nodes=True;m.use_backface_culling=True;nt=m.node_tree;nt.nodes.clear();out=nt.nodes.new('ShaderNodeOutputMaterial');p=nt.nodes.new('ShaderNodeBsdfPrincipled');nt.links.new(p.outputs['BSDF'],out.inputs['Surface']);p.inputs['Coat Weight'].default_value=coat;p.inputs['Coat Roughness'].default_value=.25;p.inputs['Specular IOR Level'].default_value=.35
 for kind,socket in [('diffuse','Base Color'),('nor_gl','Normal'),('rough','Roughness')]:
  im=bpy.data.images.load(ROOT+'/blender/tex/ph_'+prefix+'_'+kind+'.jpg',check_existing=True)
  if kind!='diffuse':im.colorspace_settings.name='Non-Color'
  im.pack();t=nt.nodes.new('ShaderNodeTexImage');t.image=im
  if kind=='nor_gl':
   nm=nt.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=normalstrength;nt.links.new(t.outputs['Color'],nm.inputs['Color']);nt.links.new(nm.outputs['Normal'],p.inputs[socket])
  elif kind=='rough':
   mul=nt.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=roughness;nt.links.new(t.outputs['Color'],mul.inputs[0]);nt.links.new(mul.outputs[0],p.inputs[socket])
  else:nt.links.new(t.outputs['Color'],p.inputs[socket])
surface('R2_WalnutSlat','walnut',.85,.18,.18)
surface('Walnut_Veneer','walnut',.85,.18,.18)
surface('R2_Floor','floor',.76,.2,.20)
surface('Leather_Cognac','leather',1.0,.30,0)
surface('R2_LeatherTan','leather',1.0,.30,0)
# Keep lightmap UV coordinates unchanged; only map the flooring at the scan's actual 2.4m scale.
shell=bpy.data.objects.get('R2_Shell');uv=shell.data.uv_layers[0]
for poly in shell.data.polygons:
 if shell.data.materials[poly.material_index].name=='R2_Floor':
  for li in poly.loop_indices:
   co=shell.matrix_world @ shell.data.vertices[shell.data.loops[li].vertex_index].co;uv.data[li].uv=(co.x/2.4,co.y/2.4)
# Restore the natural cognac upholstery instead of the purple temporary tint.
m=bpy.data.materials['Leather_Cognac']
for node in m.node_tree.nodes:
 if node.type=='TEX_IMAGE' and node.image and ('velvet_plum' in node.image.filepath):
  node.image=bpy.data.images.load(ROOT+'/public/textures/leather_albedo.jpg',check_existing=True);node.image.pack()
bpy.ops.object.select_all(action='DESELECT');selected=[]
for o in bpy.context.scene.objects:
 if o.name in names:o.select_set(True);selected.append(o)
assert {o.name for o in selected}==names, 'Source/export node names no longer match'
bpy.context.view_layer.objects.active=selected[0]
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/blender/lounge-premium.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/public/models/lounge-premium.glb',export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
subprocess.run([PYTHON,ROOT+'/blender/optimize_glb_textures.py',ROOT+'/public/models/lounge-premium.glb'],check=True)
print('PREMIUM_ROOM',json.dumps({'nodes':len(selected),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in selected if o.type=='MESH'),'bytes':os.path.getsize(ROOT+'/public/models/lounge-premium.glb'),'two_uv_meshes':sum(len(o.data.uv_layers)>=2 for o in selected if o.type=='MESH')}))
