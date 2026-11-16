import bpy, math, os, json
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=str(Path(__file__).resolve().parents[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
# A project-owned furniture asset, Blender Z-up converted to glTF Y-up on export.
# Contact planes: floor Z=0; playing surface Z=.740. Radius=.720.
def material(name, color, roughness, metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.use_backface_culling=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metal
 return m,p
felt,p=material('Felt • deep petrol wool',(.018,.105,.086),.93)
p.inputs['Sheen Weight'].default_value=0
p.inputs['Specular IOR Level'].default_value=.12
n=512
rng=np.random.default_rng(19)
y,x=np.mgrid[:n,:n];micro=rng.normal(0,.016,(n,n));weave=(np.sin(x*np.pi)+np.sin(y*np.pi))*.012
noise=np.clip(.5+micro+weave,0,1)
pix=np.ones((n,n,4),dtype=np.float32)
# Very subtle variation in actual dyed cloth, not a visible tiled pattern.
pix[:,:,:3]=np.stack([.095+noise*.028,.285+noise*.040,.249+noise*.034],axis=-1)
img=bpy.data.images.new('Petrol wool weave',width=n,height=n);img.pixels.foreach_set(pix.ravel());img.filepath_raw=ROOT+'/blender/premium_felt.png';img.file_format='PNG';img.save();img.pack()
nt=felt.node_tree;tex=nt.nodes.new('ShaderNodeTexImage');tex.image=img;nt.links.new(tex.outputs['Color'],p.inputs['Base Color'])
# This tiny normal relief is baked to a texture so it also survives GLB export.
normal=bpy.data.images.new('Wool fibre normal',width=n,height=n)
dy,dx=np.gradient(noise);norm=np.ones((n,n,4),dtype=np.float32);norm[:,:,0]=.5-dx*.18;norm[:,:,1]=.5-dy*.18;norm[:,:,2]=1
normal.colorspace_settings.name='Non-Color';normal.pixels.foreach_set(norm.ravel());normal.filepath_raw=ROOT+'/blender/premium_felt_normal.png';normal.file_format='PNG';normal.save();normal.pack()
check=np.asarray(normal.pixels[:],dtype=np.float32).reshape(n,n,4).mean(axis=(0,1))
assert .45 < check[0] < .55 and .45 < check[1] < .55 and check[2] > .99, 'Cloth normal pixels were lost during image color-space setup'
texn=nt.nodes.new('ShaderNodeTexImage');texn.image=normal;nm=nt.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.32;nt.links.new(texn.outputs['Color'],nm.inputs['Color']);nt.links.new(nm.outputs['Normal'],p.inputs['Normal'])
walnut,p=material('Walnut • oiled endgrain',(.17,.073,.028),.36)
wood=bpy.data.images.load(ROOT+'/public/textures/walnut_albedo.jpg');wood.pack();t=walnut.node_tree.nodes.new('ShaderNodeTexImage');t.image=wood;walnut.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
p.inputs['Coat Weight'].default_value=.22;p.inputs['Coat Roughness'].default_value=.3
brass,p=material('Brass • satin champagne',(.57,.36,.13),.32,.82)
base,p=material('Pedestal • charcoal bronze',(.035,.031,.027),.4,.65)
rubber,p=material('Floor pad • rubber',(.008,.01,.01),.92)
objects=[]
def finish(o,name,mat):
 o.name=name;o.data.materials.append(mat);objects.append(o)
 for poly in o.data.polygons:poly.use_smooth=True
 return o
def lathe(name,profile,mat,segments=128,flute=0):
 vs=[];fs=[]
 for r,z in profile:
  for j in range(segments):
   a=j*2*math.pi/segments;rr=r+(flute*math.cos(a*32) if r>.05 else 0);vs.append((rr*math.cos(a),rr*math.sin(a),z))
 for i in range(len(profile)-1):
  for j in range(segments):
   k=i*segments+j;l=i*segments+(j+1)%segments
   if profile[i][0] == 0: fs.append((k,l+segments,k+segments))
   elif profile[i+1][0] == 0: fs.append((k,l,k+segments))
   else: fs.append((k,l,l+segments,k+segments))
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o)
 uv=me.uv_layers.new(name='UVMap')
 for poly in me.polygons:
  for li in poly.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(v.x/1.44+.5,v.y/1.44+.5)
 return finish(o,name,mat)
# A continuous bevelled rim with no separate floating slabs.
lathe('Table_Walnut_Rim',[(.653,.701),(.711,.701),(.719,.709),(.72,.721),(.718,.735),(.711,.74),(.657,.74),(.653,.737),(.653,.701)],walnut)
# Flush cloth insert, broad enough for draw/discard piles and all hands.
cloth=lathe('Table_Felt',[(0,.737),(.650,.737),(.654,.738),(.654,.740),(0,.740)],felt)
for poly in cloth.data.polygons: poly.use_smooth=False
lathe('Table_Brass_Inlay',[(.654,.7385),(.6565,.7385),(.6565,.7403),(.654,.7403),(.654,.7385)],brass)
lathe('Table_Brass_Edge',[(.719,.712),(.7208,.712),(.7208,.714),(.719,.714),(.719,.712)],brass)
# Sculpted tulip pedestal: flutes remain subordinate to the continuous silhouette.
lathe('Table_Pedestal',[(0,.015),(.305,.015),(.323,.025),(.315,.045),(.275,.065),(.205,.10),(.145,.18),(.119,.28),(.115,.46),(.13,.57),(.18,.64),(.29,.69),(.31,.701),(0,.701)],base,128,.0011)
lathe('Table_Pedestal_Collar',[(.283,.683),(.307,.691),(.31,.699),(.289,.699),(.283,.683)],brass)
lathe('Table_Foot_Pad',[(0,.001),(.298,.001),(.304,.007),(.305,.015),(0,.015)],rubber,96)
# Inspectable hierarchy, with floor-contact origin and no scene furniture/lights.
root=bpy.data.objects.new('Table_Premium',None);bpy.context.collection.objects.link(root)
for o in objects:o.parent=root
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/blender/table-premium.blend')
bpy.ops.export_scene.gltf(filepath=ROOT+'/public/models/table-premium.glb',export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
print('TABLE_ASSET',json.dumps({'triangles':tri,'parts':[o.name for o in objects],'bounds_m':[-.7208,0,-.7208,.7208,.7403,.7208],'glb_bytes':os.path.getsize(ROOT+'/public/models/table-premium.glb')}))
