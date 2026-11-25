import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

BASE_PUBLIC = r"E:\ai\cyber-survivors-3d\public"
MODEL_DIR = os.path.join(BASE_PUBLIC, "models")
UI_DIR = os.path.join(BASE_PUBLIC, "ui")


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_lin(c):
    return pow(c / 255.0, 2.2)


def hex_rgba(hex_rgb):
    return (
        srgb_to_lin((hex_rgb >> 16) & 0xFF),
        srgb_to_lin((hex_rgb >> 8) & 0xFF),
        srgb_to_lin(hex_rgb & 0xFF),
        1.0,
    )


def make_vcol_mat(name, metallic=0.68, roughness=0.28, emission_strength=0.65):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vcol = nt.nodes.new(type='ShaderNodeVertexColor')
    vcol.layer_name = "Color"
    nt.links.new(vcol.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if 'Emission Color' in bsdf.inputs:
        nt.links.new(vcol.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def make_pbr_mat(name, hex_rgb, metallic=0.78, roughness=0.24, emit_hex=None, emit_str=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = hex_rgba(hex_rgb)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emit_hex is not None and emit_str > 0 and 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = hex_rgba(emit_hex)
        bsdf.inputs['Emission Strength'].default_value = emit_str
    return mat


def stamp_part(target_bm, target_col, part_bm, rgba, loc=(0, 0, 0), rot=(0, 0, 0)):
    bmesh.ops.recalc_face_normals(part_bm, faces=part_bm.faces)
    mat_xform = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    bmesh.ops.transform(part_bm, matrix=mat_xform, verts=part_bm.verts)
    vmap = {v: target_bm.verts.new(v.co) for v in part_bm.verts}
    for f in part_bm.faces:
        try:
            nf = target_bm.faces.new([vmap[v] for v in f.verts])
            for loop in nf.loops:
                loop[target_col] = rgba
        except ValueError:
            pass
    part_bm.free()


def add_box_vc(bm, col, sx, sy, sz, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.02):
    p = bmesh.new()
    bmesh.ops.create_cube(p, size=1.0)
    bmesh.ops.scale(p, vec=(sx, sy, sz), verts=p.verts)
    if bevel > 0:
        bmesh.ops.bevel(p, geom=list(p.edges), offset=bevel, segments=1, affect='EDGES')
    stamp_part(bm, col, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def add_cone_vc(bm, col, r1, r2, depth, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), segs=8):
    p = bmesh.new()
    bmesh.ops.create_cone(p, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    stamp_part(bm, col, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def finalize_vc_obj(name, bm, mat):
    mesh = bpy.data.meshes.new(name + "_m")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def build_stage_landmarks_and_drone_glb():
    clear_scene()
    mat = make_vcol_mat("StageDroneVCol", metallic=0.70, roughness=0.28, emission_strength=0.60)

    # 1. Prop_FoundryCore (Magma Foundry Industrial Reactor Pillar)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 1.05, 0.88, 0.42, 0x27130e, loc=(0, 0, 0.21), segs=8)
    add_cone_vc(bm, col, 0.56, 0.56, 2.55, 0xff5500, loc=(0, 0, 1.55), segs=10)
    add_cone_vc(bm, col, 0.68, 0.68, 0.22, 0xfde047, loc=(0, 0, 1.15), segs=10)
    add_cone_vc(bm, col, 0.68, 0.68, 0.22, 0xfde047, loc=(0, 0, 2.05), segs=10)
    add_cone_vc(bm, col, 0.82, 0.48, 0.45, 0x1c1917, loc=(0, 0, 2.95), segs=8)
    for k in range(4):
        ang = k * (math.pi / 2) + math.pi / 4
        add_box_vc(
            bm, col, 0.18, 0.28, 2.65, 0x431407,
            loc=(math.cos(ang) * 0.72, math.sin(ang) * 0.72, 1.58),
            rot=(0, 0, ang), bevel=0.02
        )
    finalize_vc_obj("Prop_FoundryCore", bm, mat)

    # 2. Prop_CryoObelisk (Cryo Quantum Nexus Floating Crystal Monolith)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.96, 0.78, 0.36, 0x0f172a, loc=(0, 0, 0.18), segs=6)
    add_cone_vc(bm, col, 0.55, 0.04, 2.15, 0x67e8f9, loc=(0, 0, 2.05), segs=6)
    add_cone_vc(bm, col, 0.55, 0.04, 0.85, 0x38bdf8, loc=(0, 0, 0.62), rot=(math.pi, 0, 0), segs=6)
    for k in range(3):
        ang = k * (math.tau / 3)
        add_cone_vc(
            bm, col, 0.22, 0.02, 1.05, 0xc084fc,
            loc=(math.cos(ang) * 0.68, math.sin(ang) * 0.68, 1.25),
            rot=(0.18 * math.sin(ang), -0.18 * math.cos(ang), 0), segs=5
        )
    finalize_vc_obj("Prop_CryoObelisk", bm, mat)

    # 3. Prop_HackBeacon (Interactive Tactical Capture Objective Tower)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.92, 0.76, 0.26, 0x1e293b, loc=(0, 0, 0.13), segs=8)
    add_cone_vc(bm, col, 0.28, 0.18, 2.10, 0x334155, loc=(0, 0, 1.25), segs=8)
    add_cone_vc(bm, col, 0.36, 0.36, 0.52, 0x22d3ee, loc=(0, 0, 1.55), segs=8)
    add_box_vc(bm, col, 1.15, 0.16, 0.36, 0xfbbf24, loc=(0, 0, 2.38), rot=(0.35, 0, 0), bevel=0.02)
    add_cone_vc(bm, col, 0.22, 0.02, 0.55, 0xfef08a, loc=(0, 0, 2.75), segs=6)
    finalize_vc_obj("Prop_HackBeacon", bm, mat)

    # 4. Enemy_SniperDrone (5th Enemy Archetype: Ranged Rail-Sniper Hover Drone)
    # Note: In Blender, +Y exports to -Z in Three.js; Enemy_Crawler faces +Y/-Y. Let's make barrel symmetric/forward +Y & -Y clear:
    # In Blender export_yup=True: Blender (x, y, z) -> glTF (x, z, -y).
    # In main.ts: dummy.rotation.set(0, Math.atan2(dx, dz), walkRoll), which rotates glTF +Z toward (dx, dz)!
    # glTF +Z comes from Blender -Y! So forward in Blender is -Y!
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # Hover fuselage
    add_box_vc(bm, col, 0.52, 0.78, 0.32, 0x1e1b4b, loc=(0, 0.05, 0.95), bevel=0.04)
    # Glowing crimson sniper eye & long rail barrel pointing -Y (glTF +Z forward!)
    add_cone_vc(bm, col, 0.16, 0.16, 0.22, 0xf43f5e, loc=(0, -0.34, 0.98), rot=(math.pi / 2, 0, 0), segs=8)
    add_cone_vc(bm, col, 0.09, 0.05, 0.82, 0xfef08a, loc=(0, -0.72, 0.95), rot=(math.pi / 2, 0, 0), segs=6)
    # Swept cyber wings
    for sx in (-1, 1):
        add_box_vc(
            bm, col, 0.72, 0.42, 0.09, 0x312e81,
            loc=(sx * 0.56, 0.12, 0.98),
            rot=(0, sx * -0.22, sx * 0.35), bevel=0.02
        )
        add_box_vc(
            bm, col, 0.62, 0.10, 0.11, 0xf43f5e,
            loc=(sx * 0.58, -0.06, 1.02),
            rot=(0, sx * -0.22, sx * 0.35), bevel=0.01
        )
    finalize_vc_obj("Enemy_SniperDrone", bm, mat)

    out_glb = os.path.join(MODEL_DIR, "stage_landmarks.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
    )
    print(f"Exported stage_landmarks.glb ({os.path.getsize(out_glb)} bytes)")


def setup_studio():
    clear_scene()
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 20
    scn.cycles.use_denoising = False
    scn.render.resolution_x = 192
    scn.render.resolution_y = 192
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'

    world = bpy.data.worlds.new("StageWorld")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.04, 0.09, 1.0)
        bg.inputs[1].default_value = 0.95

    cam_data = bpy.data.cameras.new("StudioCam")
    cam_data.lens = 54
    cam = bpy.data.objects.new("StudioCam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.location = (2.45, -2.65, 2.05)
    cam.rotation_euler = (Vector((0, 0, 0.15)) - cam.location).to_track_quat('-Z', 'Y').to_euler()

    for name, loc, energy, hex_c in (
        ("Key", (3.0, -2.5, 3.4), 145, 0xffffff),
        ("Rim", (-2.8, 1.8, 2.2), 115, 0x38bdf8),
        ("Fill", (1.8, 2.6, -1.0), 90, 0xf97316),
    ):
        ld = bpy.data.lights.new(name=name, type='AREA')
        ld.energy = energy
        ld.size = 2.2
        c = hex_rgba(hex_c)
        ld.color = (c[0], c[1], c[2])
        lo = bpy.data.objects.new(name, ld)
        scn.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0)) - lo.location).to_track_quat('-Z', 'Y').to_euler()

    root = bpy.data.objects.new("Root", None)
    scn.collection.objects.link(root)
    return scn, root


def clear_children(root):
    for ch in list(root.children):
        m = ch.data
        bpy.data.objects.remove(ch, do_unlink=True)
        if m and isinstance(m, bpy.types.Mesh):
            bpy.data.meshes.remove(m, do_unlink=True)


def add_prim(kind, name, scale, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), segs=12):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.03, segments=2, affect='EDGES')
    elif kind == 'cone':
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=scale[0], radius2=scale[1], depth=scale[2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_m")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)


def render_stage_icons():
    scn, root = setup_studio()
    m_dark = make_pbr_mat("SDark", 0x0f172a, 0.85, 0.22)
    m_iron = make_pbr_mat("SIron", 0x29150e, 0.82, 0.28)
    m_cyan = make_pbr_mat("SCyan", 0x22d3ee, 0.25, 0.14, 0x22d3ee, 2.5)
    m_magma = make_pbr_mat("SMagma", 0xff5500, 0.2, 0.16, 0xff6b00, 2.8)
    m_gold = make_pbr_mat("SGold", 0xfde047, 0.7, 0.16, 0xfbbf24, 1.8)
    m_ice = make_pbr_mat("SIce", 0x67e8f9, 0.15, 0.08, 0x38bdf8, 2.4)
    m_violet = make_pbr_mat("SViolet", 0xc084fc, 0.3, 0.16, 0xa855f7, 2.2)

    def save(fname):
        scn.render.filepath = os.path.join(UI_DIR, fname)
        bpy.ops.render.render(write_still=True)
        print(f"Rendered: {fname}")

    # 1. stage_ruins.png
    clear_children(root)
    add_prim('cone', 'HexPad', (0.95, 0.88, 0.18), m_dark, root, loc=(0, 0, -0.35), segs=6)
    add_prim('box', 'Pylon', (0.34, 0.34, 1.15), m_dark, root, loc=(-0.15, 0.1, 0.25))
    add_prim('box', 'HoloStrip', (0.38, 0.12, 0.95), m_cyan, root, loc=(-0.15, 0.1, 0.25))
    add_prim('cone', 'Barrel', (0.24, 0.24, 0.48), m_magma, root, loc=(0.42, -0.25, -0.02), segs=10)
    save("stage_ruins.png")

    # 2. stage_foundry.png
    clear_children(root)
    add_prim('cone', 'ForgeBase', (0.98, 0.86, 0.22), m_iron, root, loc=(0, 0, -0.35), segs=8)
    add_prim('cone', 'MagmaCore', (0.42, 0.38, 1.18), m_magma, root, loc=(0, 0, 0.26), segs=10)
    add_prim('cone', 'Ring1', (0.54, 0.54, 0.14), m_gold, root, loc=(0, 0, 0.05), segs=10)
    add_prim('cone', 'Ring2', (0.54, 0.54, 0.14), m_gold, root, loc=(0, 0, 0.52), segs=10)
    save("stage_foundry.png")

    # 3. stage_cryo.png
    clear_children(root)
    add_prim('cone', 'IcePad', (0.96, 0.88, 0.18), m_dark, root, loc=(0, 0, -0.35), segs=6)
    add_prim('cone', 'CrystalUp', (0.42, 0.03, 1.25), m_ice, root, loc=(0, 0, 0.35), segs=6)
    for k in range(3):
        a = k * math.tau / 3
        add_prim('cone', f'Shard_{k}', (0.18, 0.02, 0.68), m_violet, root, loc=(math.cos(a) * 0.52, math.sin(a) * 0.52, 0.02), segs=5)
    save("stage_cryo.png")


if __name__ == "__main__":
    build_stage_landmarks_and_drone_glb()
    render_stage_icons()
    print("=== STAGE LANDMARKS, SNIPER DRONE & STAGE ICONS COMPLETE ===")
