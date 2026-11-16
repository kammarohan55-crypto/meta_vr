import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=str(Path(__file__).resolve().parents[1])
bpy.ops.wm.open_mainfile(filepath=ROOT+'/blender/table-premium.blend')
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=16;s.cycles.use_denoising=True
s.render.resolution_x=600;s.render.resolution_y=430;s.render.resolution_percentage=100
s.world=bpy.data.worlds.new('Preview world');s.world.color=(.18,.18,.18)
bpy.ops.object.camera_add(location=(1.50,-1.85,1.83));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.42))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=46;s.camera=cam
for loc,power,size in [((0,-1.4,3),330,2.8),((-2,1,1.9),220,2),((2,1,1.2),140,1.4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,.3))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.location.z=-.002
m=bpy.data.materials.new('Preview floor');m.diffuse_color=(.11,.115,.12,1);floor.data.materials.append(m)
s.view_settings.view_transform='AgX'
s.render.filepath=ROOT+'/blender/table-premium-material.jpg';s.render.image_settings.file_format='JPEG';s.render.image_settings.quality=85;bpy.ops.render.render(write_still=True)
clay=bpy.data.materials.new('Preview clay');clay.diffuse_color=(.38,.38,.38,1)
for ob in s.objects:
 if ob.type=='MESH' and ob !=floor:ob.data.materials.clear();ob.data.materials.append(clay)
s.render.filepath=ROOT+'/blender/table-premium-clay.jpg';bpy.ops.render.render(write_still=True)
