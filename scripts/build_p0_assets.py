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


def make_vcol_mat(name, metallic=0.65, roughness=0.25, emission_strength=0.75):
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


def rebuild_weapons_and_loot_glb():
    clear_scene()
    mat = make_vcol_mat("WpnLootVColMat", metallic=0.65, roughness=0.25, emission_strength=0.75)

    # Weapon_Kunai
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.22, 0.01, 0.78, 0x67e8f9, loc=(0, 0.32, 0), rot=(-math.pi / 2, 0, 0), segs=4)
    add_box_vc(bm, col, 0.42, 0.10, 0.06, 0xfbbf24, loc=(0, -0.08, 0), bevel=0.01)
    add_box_vc(bm, col, 0.08, 0.28, 0.08, 0x1e293b, loc=(0, -0.24, 0), bevel=0.01)
    add_cone_vc(bm, col, 0.11, 0.11, 0.05, 0x22d3ee, loc=(0, -0.42, 0), segs=8)
    finalize_vc_obj("Weapon_Kunai", bm, mat)

    # Weapon_Saw
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.44, 0.44, 0.09, 0x1e293b, loc=(0, 0, 0), segs=16)
    add_cone_vc(bm, col, 0.26, 0.26, 0.13, 0xfef08a, loc=(0, 0, 0), segs=12)
    for k in range(8):
        ang = k * (math.tau / 8)
        add_cone_vc(bm, col, 0.14, 0.01, 0.34, 0xf43f5e, loc=(math.cos(ang) * 0.52, math.sin(ang) * 0.52, 0), rot=(math.pi / 2, 0, ang - 0.55), segs=4)
    finalize_vc_obj("Weapon_Saw", bm, mat)

    # Loot_Crystal
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.22, 0.02, 0.62, 0xffffff, loc=(0, 0, 0.32), segs=6)
    add_cone_vc(bm, col, 0.14, 0.02, 0.42, 0xdbeafe, loc=(0.14, 0.06, 0.22), rot=(0.15, 0.32, 0), segs=5)
    add_cone_vc(bm, col, 0.13, 0.02, 0.38, 0xdbeafe, loc=(-0.13, -0.08, 0.20), rot=(-0.18, -0.28, 0), segs=5)
    finalize_vc_obj("Loot_Crystal", bm, mat)

    # Loot_HyperPod
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.68, 0.58, 0.24, 0x1e293b, loc=(0, 0, 0.12), segs=6)
    add_cone_vc(bm, col, 0.52, 0.52, 0.64, 0xfbbf24, loc=(0, 0, 0.52), segs=6)
    add_cone_vc(bm, col, 0.36, 0.36, 0.72, 0xfef08a, loc=(0, 0, 0.56), segs=6)
    for k in range(3):
        ang = k * (math.tau / 3)
        add_box_vc(bm, col, 0.14, 0.18, 0.76, 0x78350f, loc=(math.cos(ang) * 0.54, math.sin(ang) * 0.54, 0.50), rot=(0, 0, ang), bevel=0.02)
    finalize_vc_obj("Loot_HyperPod", bm, mat)

    # Loot_MagnetCore (Full-Screen Vacuum Magnet Pickup!)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_box_vc(bm, col, 0.72, 0.18, 0.22, 0xf43f5e, loc=(0, 0, 0.92), bevel=0.03)
    for sx, tip_c in ((-0.26, 0x22d3ee), (0.26, 0xfef08a)):
        add_box_vc(bm, col, 0.20, 0.18, 0.48, 0xf43f5e, loc=(sx, 0, 0.62), bevel=0.02)
        add_box_vc(bm, col, 0.22, 0.20, 0.22, tip_c, loc=(sx, 0, 0.32), bevel=0.02)
    finalize_vc_obj("Loot_MagnetCore", bm, mat)

    # Loot_FrenzyOrb (5s Infinite Overdrive Fire-Rate Pickup!)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.38, 0.02, 0.52, 0xff2a55, loc=(0, 0, 0.85), segs=6)
    add_cone_vc(bm, col, 0.38, 0.02, 0.52, 0xfde047, loc=(0, 0, 0.35), rot=(math.pi, 0, 0), segs=6)
    for k in range(4):
        ang = k * (math.pi / 2)
        add_cone_vc(bm, col, 0.14, 0.01, 0.42, 0xf97316, loc=(math.cos(ang) * 0.42, math.sin(ang) * 0.42, 0.60), rot=(math.pi / 2, 0, ang + math.pi / 2), segs=4)
    finalize_vc_obj("Loot_FrenzyOrb", bm, mat)

    out_glb = os.path.join(MODEL_DIR, "weapons_and_loot.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
    )
    print(f"Exported upgraded weapons_and_loot.glb ({os.path.getsize(out_glb)} bytes)")


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

    world = bpy.data.worlds.new("StudioWorld")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.04, 0.09, 1.0)
        bg.inputs[1].default_value = 0.9

    cam_data = bpy.data.cameras.new("StudioCam")
    cam_data.lens = 58
    cam = bpy.data.objects.new("StudioCam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.location = (2.35, -2.55, 1.85)
    cam.rotation_euler = (Vector((0, 0, 0.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()

    for name, loc, energy, hex_c in (
        ("Key", (3.0, -2.5, 3.2), 140, 0xffffff),
        ("Rim", (-2.8, 1.8, 2.0), 110, 0x22d3ee),
        ("Fill", (1.8, 2.6, -1.2), 85, 0xc084fc),
    ):
        ld = bpy.data.lights.new(name=name, type='AREA')
        ld.energy = energy
        ld.size = 2.0
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


def add_prim(kind, name, scale, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), segs=16):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=2, affect='EDGES')
    elif kind == 'cone':
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=scale[0], radius2=scale[1], depth=scale[2])
    elif kind == 'sphere':
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    elif kind == 'torus':
        R, r = scale[0], scale[1]
        u_n, v_n = 24, 10
        rings = []
        for iu in range(u_n):
            u = iu * math.tau / u_n
            ring = []
            for iv in range(v_n):
                v = iv * math.tau / v_n
                rr = R + math.cos(v) * r
                ring.append(bm.verts.new((math.cos(u) * rr, math.sin(u) * rr, math.sin(v) * r)))
            rings.append(ring)
        for iu in range(u_n):
            r0 = rings[iu]
            r1 = rings[(iu + 1) % u_n]
            for iv in range(v_n):
                nv = (iv + 1) % v_n
                bm.faces.new((r0[iv], r0[nv], r1[nv], r1[iv]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name + "_m")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = (kind in ('sphere', 'torus'))
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)


def render_new_p0_icons():
    scn, root = setup_studio()
    m_steel = make_pbr_mat("PSteel", 0x111827, 0.88, 0.20)
    m_void = make_pbr_mat("PVoid", 0x05030a, 0.1, 0.05, 0x3b0764, 0.6)
    m_violet = make_pbr_mat("PViolet", 0xa855f7, 0.3, 0.16, 0xc084fc, 2.5)
    m_gold = make_pbr_mat("PGold", 0xfbbf24, 0.9, 0.16, 0xf59e0b, 0.9)
    m_cyan = make_pbr_mat("PCyan", 0x22d3ee, 0.2, 0.15, 0x22d3ee, 2.4)
    m_orange = make_pbr_mat("POrange", 0xf97316, 0.3, 0.16, 0xff6b00, 2.6)
    m_white = make_pbr_mat("PWhite", 0xffffff, 0.1, 0.1, 0xfef08a, 3.2)

    def save(fname):
        scn.render.filepath = os.path.join(UI_DIR, fname)
        bpy.ops.render.render(write_still=True)
        print(f"Rendered: {fname}")

    # 1. wpn_gravity.png (Nano Gravity Well)
    clear_children(root)
    add_prim('sphere', 'Core', (0.36, 0.36, 0.36), m_void, root)
    add_prim('torus', 'Vortex1', (0.66, 0.075, 0), m_violet, root, rot=(0.55, -0.35, 0))
    add_prim('torus', 'Vortex2', (0.48, 0.045, 0), m_cyan, root, rot=(0.55, -0.35, 0))
    save("wpn_gravity.png")

    # 2. wpn_gravity_hyper.png (★ Singularity Collapse Black Hole!)
    clear_children(root)
    add_prim('sphere', 'EventHorizon', (0.44, 0.44, 0.44), m_void, root)
    add_prim('torus', 'AccretionDisk', (0.82, 0.11, 0), m_gold, root, rot=(0.48, -0.32, 0))
    add_prim('torus', 'PhotonRing', (0.54, 0.06, 0), m_violet, root, rot=(-0.75, 0.45, 0))
    save("wpn_gravity_hyper.png")

    # 3. wpn_orbital.png (Orbital Ion Mortar Satellite)
    clear_children(root)
    add_prim('cone', 'Barrel', (0.34, 0.22, 0.95), m_steel, root, loc=(0, 0, 0.15), segs=8)
    add_prim('cone', 'BeamTip', (0.20, 0.04, 0.55), m_orange, root, loc=(0, 0, -0.45), rot=(math.pi, 0, 0), segs=8)
    for sx in (-1, 1):
        add_prim('box', f'Wing_{sx}', (0.68, 0.08, 0.36), m_cyan, root, loc=(sx * 0.62, 0, 0.22), rot=(0.25, 0, 0))
    save("wpn_orbital.png")

    # 4. wpn_orbital_hyper.png (★ Skynet Judgement Seraphim Array)
    clear_children(root)
    add_prim('sphere', 'SunCore', (0.34, 0.34, 0.34), m_white, root, loc=(0, 0, 0.25))
    add_prim('torus', 'Halo', (0.72, 0.07, 0), m_gold, root, loc=(0, 0, 0.25), rot=(0.45, -0.25, 0))
    for k in range(3):
        a = k * math.tau / 3
        add_prim('cone', f'Lance_{k}', (0.14, 0.02, 0.95), m_gold, root, loc=(math.cos(a) * 0.48, math.sin(a) * 0.48, -0.15), rot=(math.pi, 0, 0), segs=6)
    save("wpn_orbital_hyper.png")

    # 5. chip_thruster.png (Frenzy Thruster Passive Chip — Duration & Projectile Speed)
    clear_children(root)
    for sx in (-0.32, 0.32):
        add_prim('cone', f'Nozzle_{sx}', (0.28, 0.18, 0.72), m_steel, root, loc=(sx, 0, 0.18), rot=(0.35, 0, 0), segs=12)
        add_prim('cone', f'Plume_{sx}', (0.22, 0.02, 0.68), m_orange, root, loc=(sx, 0.18, -0.38), rot=(math.pi + 0.35, 0, 0), segs=10)
    add_prim('box', 'Manifold', (0.92, 0.28, 0.24), m_gold, root, loc=(0, -0.08, 0.48), rot=(0.35, 0, 0))
    save("chip_thruster.png")


if __name__ == "__main__":
    rebuild_weapons_and_loot_glb()
    render_new_p0_icons()
    print("=== P0 MODELS & CYCLES ICONS EXPORTED ===")
