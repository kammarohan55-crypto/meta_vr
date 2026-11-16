"""Photographic distant architecture. Table, players and interactive content remain real 3D."""
import bpy
import math
import json
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
image = bpy.data.images.load(str(root / 'public/textures/penthouse-night-v1.jpg'))
image.pack()
material = bpy.data.materials.new('Penthouse photographic architectural matte')
material.use_nodes = True
material.use_backface_culling = True
nodes = material.node_tree.nodes
nodes.clear()
output = nodes.new('ShaderNodeOutputMaterial')
emission = nodes.new('ShaderNodeEmission')
texture = nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], emission.inputs['Color'])
material.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])
emission.inputs['Strength'].default_value = 1.0
bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.object
plane.name = 'Penthouse_Architectural_Backdrop'
plane.scale = (10, 5, 1)
plane.rotation_euler.x = math.pi / 2
plane.data.materials.append(material)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'blender/penthouse-backdrop-v1.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'public/models/penthouse-backdrop-v1.glb'), export_format='GLB', export_yup=True, export_apply=True)
# Keep the photographed matte unlit in every glTF viewer, including the game.
path = root / 'public/models/penthouse-backdrop-v1.glb'
data = path.read_bytes()
json_length = struct.unpack_from('<I', data, 12)[0]
document = json.loads(data[20:20 + json_length])
for mat in document['materials']:
    mat['pbrMetallicRoughness']['baseColorTexture'] = mat.pop('emissiveTexture')
    mat['pbrMetallicRoughness']['baseColorFactor'] = [1.0, 1.0, 1.0, 1]
    mat.pop('emissiveFactor', None)
    mat['extensions'] = {'KHR_materials_unlit': {}}
document['extensionsUsed'] = ['KHR_materials_unlit']
encoded = json.dumps(document, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
binary_chunk = data[20 + json_length:]
path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(binary_chunk)) + struct.pack('<I4s', len(encoded), b'JSON') + encoded + binary_chunk)
print('Penthouse matte exported: 20m wide, 10m high, facing local +Z, centered origin')
