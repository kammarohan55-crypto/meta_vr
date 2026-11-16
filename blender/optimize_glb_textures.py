"""Compress embedded GLB images without changing geometry, UVs, nodes or materials."""
import io, json, struct, sys
from pathlib import Path
from PIL import Image, ImageStat
p=Path(sys.argv[1]);data=p.read_bytes();n=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+n]);binary=data[28+n:]
assert len(j['buffers'])==1
replacements={};stats=[]
for im in j.get('images',[]):
 vi=im['bufferView'];v=j['bufferViews'][vi];raw=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];src=Image.open(io.BytesIO(raw));src.load();old=src.size;src.thumbnail((1024,1024),Image.Resampling.LANCZOS)
 alpha=src.mode in ('RGBA','LA') and src.getchannel('A').getextrema()[0]<255
 out=io.BytesIO()
 if alpha:
  src.save(out,'PNG',optimize=True);im['mimeType']='image/png'
 else:
  src=src.convert('RGB');src.save(out,'JPEG',quality=90,optimize=True);im['mimeType']='image/jpeg'
 if 'nor_gl' in im.get('name',''):
  avg=ImageStat.Stat(src.convert('RGB')).mean;assert avg[2]>180 and avg[0]>80 and avg[1]>80,('Invalid normal map',im.get('name'),avg)
 replacements[vi]=out.getvalue();stats.append((im.get('name'),old,src.size,len(raw),len(replacements[vi])))
buf=bytearray()
for vi,v in enumerate(j['bufferViews']):
 raw=replacements.get(vi)
 if raw is None:raw=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 while len(buf)%4:buf.append(0)
 v['byteOffset']=len(buf);v['byteLength']=len(raw);buf.extend(raw)
while len(buf)%4:buf.append(0)
j['buffers'][0]['byteLength']=len(buf);rawj=json.dumps(j,separators=(',',':'),ensure_ascii=False).encode()
while len(rawj)%4:rawj+=b' '
result=struct.pack('<4sII',b'glTF',2,12+8+len(rawj)+8+len(buf))+struct.pack('<I4s',len(rawj),b'JSON')+rawj+struct.pack('<I4s',len(buf),b'BIN\0')+buf
p.write_bytes(result)
print(json.dumps({'path':str(p),'before_MB':round(len(data)/1e6,2),'after_MB':round(len(result)/1e6,2),'images':len(stats),'node_count':len(j['nodes']),'mesh_count':len(j['meshes'])}))
