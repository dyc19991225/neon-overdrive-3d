import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler

BASE_PUBLIC = r"E:\ai\cyber-survivors-3d\public"
MODEL_DIR = os.path.join(BASE_PUBLIC, "models")
UI_DIR = os.path.join(BASE_PUBLIC, "ui")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(UI_DIR, exist_ok=True)


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


def make_vcol_pbr_mat(name, metallic=0.72, roughness=0.30, emission_strength=0.45):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
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


def make_solid_mat(name, hex_rgb, metallic=0.76, roughness=0.26, emission_hex=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = hex_rgba(hex_rgb)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission_hex is not None and emission_strength > 0:
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = hex_rgba(emission_hex)
            bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def stamp_part(target_bm, target_col, part_bm, rgba, loc=(0, 0, 0), rot=(0, 0, 0)):
    bmesh.ops.recalc_face_normals(part_bm, faces=part_bm.faces)
    mat_xform = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    bmesh.ops.transform(part_bm, matrix=mat_xform, verts=part_bm.verts)

    vert_map = {v: target_bm.verts.new(v.co) for v in part_bm.verts}
    for f in part_bm.faces:
        try:
            nf = target_bm.faces.new([vert_map[v] for v in f.verts])
            for loop in nf.loops:
                loop[target_col] = rgba
        except ValueError:
            pass
    part_bm.free()


def add_box_vc(bm, col_layer, sx, sy, sz, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.025):
    p = bmesh.new()
    bmesh.ops.create_cube(p, size=1.0)
    bmesh.ops.scale(p, vec=(sx, sy, sz), verts=p.verts)
    if bevel > 0:
        bmesh.ops.bevel(p, geom=list(p.edges), offset=bevel, segments=1, affect='EDGES')
    stamp_part(bm, col_layer, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def add_cone_vc(bm, col_layer, r1, r2, depth, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), segs=8):
    p = bmesh.new()
    bmesh.ops.create_cone(p, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    stamp_part(bm, col_layer, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def add_sphere_vc(bm, col_layer, rx, ry, rz, hex_rgb, loc=(0, 0, 0), rot=(0, 0, 0), subdiv=1):
    p = bmesh.new()
    bmesh.ops.create_icosphere(p, subdivisions=subdiv, radius=1.0)
    bmesh.ops.scale(p, vec=(rx, ry, rz), verts=p.verts)
    stamp_part(bm, col_layer, p, hex_rgba(hex_rgb), loc=loc, rot=rot)


def finalize_vcol_obj(name, bm, mat, loc=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    print(f"  Built {name}: {len(mesh.polygons)} polys")
    return obj


def make_child_part(name, kind, scale, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.03, segs=10):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    elif kind == 'cone':
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=scale[0], radius2=scale[1], depth=scale[2])
    elif kind == 'sphere':
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
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
    return o


def export_glb(filepath):
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
    )
    print(f"Exported GLB: {filepath} ({os.path.getsize(filepath)} bytes)")


# =========================================================================
# 1. Upgraded Hard-Surface Enemy Mechs (enemy_mechs.glb)
# Note: -Y in Blender exports to +Z in glTF (Enemy Forward!)
# =========================================================================
def build_enemy_mechs():
    clear_scene()
    mat = make_vcol_pbr_mat("EnemyMechVColMat", metallic=0.70, roughness=0.32, emission_strength=0.42)

    # ---------------------------------------------------------------------
    # Type 0: Enemy_Crawler — Articulated Quad-Legged Cyber-Arachnid Hunter
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    # Faceted Cephalothorax + Dorsal Armor Spine
    add_box_vc(bm, col, 0.56, 0.68, 0.26, 0x3b0764, loc=(0, 0.0, 0.44), bevel=0.05)
    add_box_vc(bm, col, 0.38, 0.52, 0.14, 0x6b21a8, loc=(0, -0.02, 0.59), bevel=0.03)
    # Raised Abdomen Capacitor + 3 Glowing Plasma Ribs
    add_box_vc(bm, col, 0.46, 0.52, 0.28, 0x581c87, loc=(0, 0.46, 0.56), rot=(0.24, 0, 0), bevel=0.05)
    for rz in (0.34, 0.48, 0.62):
        add_box_vc(bm, col, 0.50, 0.06, 0.16, 0xe879f9, loc=(0, rz, 0.63), rot=(0.24, 0, 0), bevel=0.01)
    # Triple Neon-Magenta Optic Cluster + Serrated Plasma Mandibles (-Y front)
    add_box_vc(bm, col, 0.44, 0.12, 0.10, 0xff2a85, loc=(0, -0.35, 0.46), bevel=0.015)
    add_sphere_vc(bm, col, 0.08, 0.06, 0.08, 0xfdf4ff, loc=(0, -0.40, 0.48), subdiv=1)
    for sx in (-1, 1):
        add_cone_vc(bm, col, 0.075, 0.01, 0.38, 0xf472b6, loc=(sx * 0.19, -0.48, 0.36), rot=(math.pi / 2, 0, sx * 0.22), segs=6)
        add_box_vc(bm, col, 0.08, 0.18, 0.08, 0x1e293b, loc=(sx * 0.22, -0.32, 0.38), bevel=0.01)
    # Rear Thruster Exhaust
    add_cone_vc(bm, col, 0.15, 0.08, 0.20, 0xf43f5e, loc=(0, 0.74, 0.56), rot=(-math.pi / 2, 0, 0), segs=8)
    # 4 Multi-Jointed Arachnid Legs (Coxa + Femur + Hydraulic Piston + Razor Claw)
    for sx in (-1, 1):
        for fy in (-0.22, 0.24):
            add_sphere_vc(bm, col, 0.10, 0.10, 0.10, 0x475569, loc=(sx * 0.28, fy, 0.45), subdiv=1)
            add_box_vc(bm, col, 0.38, 0.11, 0.11, 0x1e293b, loc=(sx * 0.44, fy, 0.54), rot=(0, sx * 0.46, sx * fy * 0.45), bevel=0.02)
            add_box_vc(bm, col, 0.10, 0.11, 0.50, 0x334155, loc=(sx * 0.62, fy * 1.18, 0.27), rot=(0, -sx * 0.20, 0), bevel=0.015)
            add_cone_vc(bm, col, 0.07, 0.015, 0.18, 0xc084fc, loc=(sx * 0.66, fy * 1.18, 0.07), rot=(math.pi, 0, 0), segs=5)
    finalize_vcol_obj("Enemy_Crawler", bm, mat)

    # ---------------------------------------------------------------------
    # Type 1: Enemy_Kamikaze — 6-Legged Volatile Fusion Tick-Walker
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.46, 0.36, 0.26, 0x18181b, loc=(0, 0, 0.30), segs=8)
    add_cone_vc(bm, col, 0.38, 0.42, 0.10, 0xf59e0b, loc=(0, 0, 0.45), segs=8)
    # Unstable Blazing Fusion Core + Intersecting Roll-Cage Rings
    add_sphere_vc(bm, col, 0.38, 0.38, 0.36, 0xff7b00, loc=(0, 0.04, 0.68), subdiv=2)
    add_box_vc(bm, col, 0.84, 0.08, 0.48, 0x27272a, loc=(0, 0.04, 0.68), bevel=0.015)
    add_box_vc(bm, col, 0.08, 0.84, 0.48, 0x27272a, loc=(0, 0.04, 0.68), bevel=0.015)
    for sx in (-0.18, 0.18):
        add_cone_vc(bm, col, 0.065, 0.015, 0.28, 0xfef08a, loc=(sx, 0.06, 1.06), rot=(0, sx * 0.4, 0), segs=6)
    # Front Detonator Cyclops Optic + Bumper Prongs
    add_sphere_vc(bm, col, 0.14, 0.10, 0.12, 0xff1e42, loc=(0, -0.40, 0.36), subdiv=1)
    for sx in (-1, 1):
        add_box_vc(bm, col, 0.07, 0.22, 0.07, 0xf97316, loc=(sx * 0.20, -0.44, 0.28), bevel=0.01)
    # 6 Articulated Bomb-Walker Legs
    for sx in (-1, 1):
        for ly in (-0.28, 0.0, 0.28):
            add_box_vc(bm, col, 0.32, 0.08, 0.09, 0x3f3f46, loc=(sx * 0.44, ly, 0.34), rot=(0, sx * 0.52, 0), bevel=0.015)
            add_sphere_vc(bm, col, 0.06, 0.06, 0.06, 0xfbbf24, loc=(sx * 0.56, ly, 0.26), subdiv=1)
            add_box_vc(bm, col, 0.08, 0.08, 0.32, 0xf97316, loc=(sx * 0.58, ly, 0.14), rot=(0, -sx * 0.12, 0), bevel=0.01)
    finalize_vcol_obj("Enemy_Kamikaze", bm, mat)

    # ---------------------------------------------------------------------
    # Type 2: Enemy_ShieldMech — Heavy Corporate Riot-Enforcer Mech
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    for sx in (-1, 1):
        add_box_vc(bm, col, 0.25, 0.38, 0.12, 0x0f172a, loc=(sx * 0.23, -0.05, 0.06), bevel=0.02)
        add_box_vc(bm, col, 0.20, 0.24, 0.42, 0x1e3a5f, loc=(sx * 0.23, 0.0, 0.32), bevel=0.025)
        add_box_vc(bm, col, 0.22, 0.12, 0.20, 0x38bdf8, loc=(sx * 0.23, -0.14, 0.49), rot=(-0.15, 0, 0), bevel=0.02)
        add_box_vc(bm, col, 0.22, 0.24, 0.34, 0x1e293b, loc=(sx * 0.23, 0.02, 0.67), bevel=0.02)
    # Pelvis Tassets & Sculpted Chestplate
    add_box_vc(bm, col, 0.58, 0.36, 0.18, 0x334155, loc=(0, 0, 0.88), bevel=0.025)
    add_box_vc(bm, col, 0.38, 0.10, 0.24, 0x0284c7, loc=(0, -0.20, 0.80), rot=(0.18, 0, 0), bevel=0.02)
    add_box_vc(bm, col, 0.74, 0.48, 0.50, 0x0369a1, loc=(0, 0, 1.20), bevel=0.05)
    add_box_vc(bm, col, 0.36, 0.12, 0.18, 0x67e8f9, loc=(0, -0.24, 1.22), bevel=0.015)
    add_box_vc(bm, col, 0.48, 0.24, 0.38, 0x0f172a, loc=(0, 0.28, 1.22), bevel=0.03)
    # V-Visor Helmet + Dual Comms Blades
    add_box_vc(bm, col, 0.35, 0.36, 0.28, 0x0f172a, loc=(0, -0.02, 1.58), bevel=0.04)
    add_box_vc(bm, col, 0.31, 0.09, 0.09, 0x7dd3fc, loc=(0, -0.19, 1.59), bevel=0.01)
    for sx in (-1, 1):
        add_box_vc(bm, col, 0.04, 0.08, 0.24, 0x38bdf8, loc=(sx * 0.17, 0.04, 1.77), rot=(0, sx * 0.15, 0), bevel=0.008)
        add_box_vc(bm, col, 0.30, 0.44, 0.28, 0x0284c7, loc=(sx * 0.52, 0, 1.34), rot=(0, -sx * 0.22, 0), bevel=0.035)
    # Right Arm (+X): Tri-Barrel Pulse Rifle
    add_box_vc(bm, col, 0.20, 0.44, 0.20, 0x1e293b, loc=(0.54, -0.18, 1.04), bevel=0.02)
    add_cone_vc(bm, col, 0.075, 0.06, 0.58, 0x38bdf8, loc=(0.54, -0.56, 1.04), rot=(math.pi / 2, 0, 0), segs=8)
    add_box_vc(bm, col, 0.14, 0.12, 0.16, 0xfbbf24, loc=(0.54, -0.82, 1.04), bevel=0.015)
    # Left Arm (-X): Multi-Layered Hexagonal Energy Riot-Tower-Shield
    add_box_vc(bm, col, 0.68, 0.10, 1.06, 0x0f172a, loc=(-0.30, -0.44, 0.92), rot=(0, 0, -0.06), bevel=0.03)
    add_box_vc(bm, col, 0.54, 0.12, 0.88, 0x38bdf8, loc=(-0.30, -0.46, 0.92), rot=(0, 0, -0.06), bevel=0.02)
    add_box_vc(bm, col, 0.30, 0.14, 0.18, 0xa5f3fc, loc=(-0.30, -0.48, 1.12), rot=(0, 0, -0.06), bevel=0.01)
    finalize_vcol_obj("Enemy_ShieldMech", bm, mat)

    # ---------------------------------------------------------------------
    # Type 3: Enemy_Juggernaut — Quad-Walker Twin-Railgun Siege Dreadnought
    # ---------------------------------------------------------------------
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box_vc(bm, col, 0.36, 0.54, 0.28, 0x18181b, loc=(sx * 0.50, sy * 0.38, 0.14), bevel=0.035)
            add_box_vc(bm, col, 0.25, 0.28, 0.44, 0x3f3f46, loc=(sx * 0.44, sy * 0.30, 0.45), bevel=0.025)
            add_box_vc(bm, col, 0.38, 0.10, 0.13, 0xe11d48, loc=(sx * 0.50, sy * 0.64, 0.13), bevel=0.015)
    # Dreadnought Hull + Sloped Reactive Armor + Blazing Furnace Core
    add_box_vc(bm, col, 1.02, 0.98, 0.28, 0x27272a, loc=(0, 0, 0.68), bevel=0.04)
    add_box_vc(bm, col, 1.16, 0.90, 0.58, 0x881337, loc=(0, 0.02, 1.10), bevel=0.06)
    add_box_vc(bm, col, 0.56, 0.16, 0.28, 0xff1e42, loc=(0, -0.45, 1.08), bevel=0.02)
    add_box_vc(bm, col, 0.64, 0.08, 0.08, 0xfbbf24, loc=(0, -0.46, 1.25), bevel=0.01)
    # Horned Turret Head
    add_box_vc(bm, col, 0.50, 0.46, 0.28, 0x18181b, loc=(0, -0.08, 1.50), bevel=0.04)
    add_box_vc(bm, col, 0.44, 0.10, 0.09, 0xfda4af, loc=(0, -0.31, 1.51), bevel=0.01)
    for sx in (-1, 1):
        add_box_vc(bm, col, 0.28, 0.08, 0.10, 0xfbbf24, loc=(sx * 0.32, -0.26, 1.66), rot=(0, -sx * 0.45, 0), bevel=0.01)
        # Twin Over-Shoulder Heavy Siege Rail-Cannons + ForearmGatlings
        add_box_vc(bm, col, 0.32, 0.58, 0.32, 0x9f1239, loc=(sx * 0.50, 0.08, 1.56), bevel=0.035)
        add_cone_vc(bm, col, 0.095, 0.075, 0.92, 0x334155, loc=(sx * 0.50, -0.56, 1.58), rot=(math.pi / 2, 0, 0), segs=10)
        add_cone_vc(bm, col, 0.115, 0.115, 0.12, 0xfb7185, loc=(sx * 0.50, -0.98, 1.58), rot=(math.pi / 2, 0, 0), segs=10)
        # Side Forearm Rotary Pod
        add_box_vc(bm, col, 0.24, 0.52, 0.24, 0x1f2937, loc=(sx * 0.72, -0.24, 1.06), bevel=0.025)
        add_cone_vc(bm, col, 0.08, 0.08, 0.32, 0xf59e0b, loc=(sx * 0.72, -0.58, 1.06), rot=(math.pi / 2, 0, 0), segs=8)
    finalize_vcol_obj("Enemy_Juggernaut", bm, mat)

    export_glb(os.path.join(MODEL_DIR, "enemy_mechs.glb"))


# =========================================================================
# 2. Upgraded Omega Cyber-Shogun Seraphim Titan (boss_titan.glb)
# Hierarchical nodes: Boss_Legs, Boss_Torso, Boss_Head, Boss_LeftArm,
# Boss_RightArm, Boss_Wings -> Boss_WingL_0..2, Boss_WingR_0..2
# =========================================================================
def build_boss_titan():
    clear_scene()
    m_dark = make_solid_mat("BossDarkSteel", 0x0f172a, metallic=0.86, roughness=0.25)
    m_slate = make_solid_mat("BossSlate", 0x334155, metallic=0.80, roughness=0.30)
    m_armor = make_solid_mat("BossCrimsonArmor", 0x9f1239, metallic=0.76, roughness=0.24, emission_hex=0x881337, emission_strength=0.22)
    m_gold = make_solid_mat("BossGoldTrim", 0xfbbf24, metallic=0.90, roughness=0.18, emission_hex=0xf59e0b, emission_strength=0.45)
    m_glow = make_solid_mat("BossCoreGlow", 0xfff1f2, metallic=0.15, roughness=0.15, emission_hex=0xf43f5e, emission_strength=0.92)

    root = bpy.data.objects.new("Boss_Root", None)
    bpy.context.scene.collection.objects.link(root)

    # 1. Heavy Samurai Titan Legs & Kusazuri Waist Tassets
    legs = bpy.data.objects.new("Boss_Legs", None)
    legs.parent = root
    bpy.context.scene.collection.objects.link(legs)
    make_child_part("Pelvis", 'box', (1.38, 0.88, 0.42), m_dark, legs, loc=(0, 0, 1.48), bevel=0.05)
    make_child_part("SkirtFront", 'box', (0.86, 0.16, 0.58), m_armor, legs, loc=(0, -0.48, 1.32), rot=(0.20, 0, 0), bevel=0.03)
    make_child_part("SkirtFrontTrim", 'box', (0.56, 0.18, 0.14), m_gold, legs, loc=(0, -0.52, 1.12), rot=(0.20, 0, 0), bevel=0.02)
    for sx in (-1, 1):
        make_child_part(f"SkirtSide_{sx}", 'box', (0.18, 0.78, 0.56), m_armor, legs, loc=(sx * 0.82, 0, 1.34), rot=(0, -sx * 0.22, 0), bevel=0.03)
        make_child_part(f"Foot_{sx}", 'box', (0.64, 0.96, 0.26), m_dark, legs, loc=(sx * 0.58, -0.08, 0.13), bevel=0.04)
        make_child_part(f"ToeClaw_{sx}", 'box', (0.48, 0.34, 0.22), m_gold, legs, loc=(sx * 0.58, -0.50, 0.12), bevel=0.03)
        make_child_part(f"Shin_{sx}", 'box', (0.54, 0.60, 0.84), m_armor, legs, loc=(sx * 0.58, 0.0, 0.66), bevel=0.05)
        make_child_part(f"KneeSpike_{sx}", 'cone', (0.24, 0.04, 0.46), m_gold, legs, loc=(sx * 0.58, -0.38, 0.98), rot=(0.45, 0, 0), segs=6)
        make_child_part(f"Thigh_{sx}", 'box', (0.48, 0.52, 0.64), m_slate, legs, loc=(sx * 0.54, 0.0, 1.22), bevel=0.04)

    # 2. Articulated Shogun Upper Torso
    torso = bpy.data.objects.new("Boss_Torso", None)
    torso.parent = root
    torso.location = (0, 0, 1.72)
    bpy.context.scene.collection.objects.link(torso)
    make_child_part("Abdomen", 'box', (1.18, 0.82, 0.38), m_slate, torso, loc=(0, 0.04, 0.16), bevel=0.04)
    make_child_part("ChestBlock", 'box', (1.78, 1.12, 0.96), m_armor, torso, loc=(0, 0, 0.66), bevel=0.08)
    make_child_part("ChestCore", 'cone', (0.36, 0.24, 0.22), m_glow, torso, loc=(0, -0.54, 0.68), rot=(math.pi / 2, 0, 0), segs=8)
    make_child_part("ChestRibU", 'box', (1.28, 0.16, 0.12), m_gold, torso, loc=(0, -0.52, 0.96), bevel=0.02)
    make_child_part("ChestRibL", 'box', (1.02, 0.16, 0.10), m_gold, torso, loc=(0, -0.50, 0.42), bevel=0.02)
    make_child_part("CollarGold", 'box', (1.14, 0.74, 0.22), m_gold, torso, loc=(0, -0.04, 1.18), bevel=0.03)

    # Massive Layered Winged Shoulder Pauldrons
    for sx in (-1, 1):
        make_child_part(f"PauldronMain_{sx}", 'box', (0.82, 1.02, 0.62), m_armor, torso, loc=(sx * 1.22, 0, 0.90), rot=(0, -sx * 0.28, 0), bevel=0.05)
        make_child_part(f"PauldronUpper_{sx}", 'box', (0.72, 0.72, 0.24), m_dark, torso, loc=(sx * 1.28, 0.02, 1.24), rot=(0, -sx * 0.42, 0), bevel=0.03)
        make_child_part(f"PauldronGold_{sx}", 'box', (0.88, 0.20, 0.16), m_gold, torso, loc=(sx * 1.28, -0.38, 1.08), rot=(0, -sx * 0.28, 0), bevel=0.02)

    # 3. Articulated Kabuto Samurai-Gundam Head (Boss_Head)
    head = bpy.data.objects.new("Boss_Head", None)
    head.parent = torso
    head.location = (0, -0.05, 1.48)
    bpy.context.scene.collection.objects.link(head)
    make_child_part("HeadHelm", 'box', (0.64, 0.68, 0.56), m_dark, head, loc=(0, 0, 0), bevel=0.05)
    make_child_part("KabutoSkirt", 'box', (0.82, 0.62, 0.22), m_armor, head, loc=(0, 0.08, -0.14), bevel=0.03)
    make_child_part("HeadVisor", 'box', (0.56, 0.14, 0.15), m_glow, head, loc=(0, -0.33, 0.02), bevel=0.015)
    make_child_part("CrestJewel", 'box', (0.14, 0.16, 0.28), m_glow, head, loc=(0, -0.32, 0.26), bevel=0.02)
    for sx in (-1, 1):
        make_child_part(f"VFinMain_{sx}", 'box', (0.78, 0.09, 0.14), m_gold, head, loc=(sx * 0.46, -0.30, 0.34), rot=(0, -sx * 0.50, 0), bevel=0.015)
        make_child_part(f"VFinSub_{sx}", 'box', (0.48, 0.08, 0.10), m_glow, head, loc=(sx * 0.34, -0.28, 0.18), rot=(0, -sx * 0.32, 0), bevel=0.01)

    # 4. Right Arm (+X): Twin Hyper-Rail Buster Cannon
    r_arm = bpy.data.objects.new("Boss_RightArm", None)
    r_arm.parent = torso
    r_arm.location = (1.30, -0.10, 0.54)
    bpy.context.scene.collection.objects.link(r_arm)
    make_child_part("RArmUpper", 'box', (0.38, 0.42, 0.48), m_slate, r_arm, loc=(0, 0, 0.08), bevel=0.03)
    make_child_part("RArmHousing", 'box', (0.50, 0.92, 0.46), m_dark, r_arm, loc=(0, -0.36, -0.16), bevel=0.04)
    for bx in (-0.13, 0.13):
        make_child_part(f"RBusterBarrel_{bx}", 'cone', (0.10, 0.085, 1.78), m_gold, r_arm, loc=(bx, -1.24, -0.12), rot=(math.pi / 2, 0, 0), segs=10)
    for cy in (-0.95, -1.45):
        make_child_part(f"RCoil_{cy}", 'box', (0.54, 0.14, 0.30), m_armor, r_arm, loc=(0, cy, -0.12), bevel=0.02)
    make_child_part("RBusterMuzzle", 'box', (0.52, 0.20, 0.28), m_glow, r_arm, loc=(0, -2.06, -0.12), bevel=0.02)

    # 5. Left Arm (-X): Giant Crimson-Gold Plasma Odachi Greatsword
    l_arm = bpy.data.objects.new("Boss_LeftArm", None)
    l_arm.parent = torso
    l_arm.location = (-1.30, -0.10, 0.54)
    bpy.context.scene.collection.objects.link(l_arm)
    make_child_part("LArmUpper", 'box', (0.38, 0.42, 0.48), m_slate, l_arm, loc=(0, 0, 0.08), bevel=0.03)
    make_child_part("LArmGauntlet", 'box', (0.46, 0.82, 0.44), m_dark, l_arm, loc=(0, -0.30, -0.15), bevel=0.04)
    make_child_part("SwordTsuba", 'box', (0.56, 0.18, 0.52), m_gold, l_arm, loc=(0, -0.78, -0.12), bevel=0.03)
    make_child_part("SwordSpine", 'box', (0.10, 2.25, 0.16), m_dark, l_arm, loc=(0, -1.92, -0.02), bevel=0.015)
    make_child_part("SwordBlade", 'box', (0.09, 2.45, 0.38), m_glow, l_arm, loc=(0, -2.04, -0.16), bevel=0.015)

    # 6. 6-Wing Seraphim Booster Pack with Individually Animatable Wing Nodes!
    wings = bpy.data.objects.new("Boss_Wings", None)
    wings.parent = torso
    wings.location = (0, 0.58, 0.78)
    bpy.context.scene.collection.objects.link(wings)
    make_child_part("WingHub", 'box', (0.78, 0.48, 0.72), m_dark, wings, loc=(0, 0.10, 0), bevel=0.05)
    make_child_part("WingTurbine", 'cone', (0.28, 0.18, 0.32), m_glow, wings, loc=(0, 0.38, 0), rot=(-math.pi / 2, 0, 0), segs=10)

    for side_tag, sx in (("L", -1), ("R", 1)):
        for wi, ang in enumerate((0.52, 0.06, -0.40)):
            w_piv = bpy.data.objects.new(f"Boss_Wing{side_tag}_{wi}", None)
            w_piv.parent = wings
            w_piv.location = (sx * 0.34, 0.16, 0.24 - wi * 0.24)
            w_piv.rotation_euler = (0.14, -sx * ang, sx * 0.18)
            bpy.context.scene.collection.objects.link(w_piv)

            make_child_part(f"WSpar_{side_tag}_{wi}", 'box', (1.35, 0.12, 0.18), m_dark, w_piv, loc=(sx * 0.68, 0, 0.06), bevel=0.02)
            make_child_part(f"WGold_{side_tag}_{wi}", 'box', (1.55, 0.09, 0.10), m_gold, w_piv, loc=(sx * 0.80, 0, 0.14), bevel=0.015)
            make_child_part(f"WFeather_{side_tag}_{wi}", 'box', (1.75, 0.06, 0.28), m_glow, w_piv, loc=(sx * 0.98, 0.02, -0.08), bevel=0.015)

    export_glb(os.path.join(MODEL_DIR, "boss_titan.glb"))


# =========================================================================
# 3. Upgraded Player Mech Armory Kits + Gundam V-Fin Helmets (mech_armory.glb)
# IMPORTANT ORIENTATION FOR PLAYER GROUP:
# In main.ts, playerGroup faces -Z in Three.js (+Z is backpack/thrusters).
# Blender export_yup=True maps:
#   Blender +Y -> Three.js -Z (PLAYER FRONT: chest core, visor, warheads!)
#   Blender -Y -> Three.js +Z (PLAYER BACK: thrusters, wings, funnels!)
#   Blender +Z -> Three.js +Y (UP!)
# =========================================================================
def build_player_mech_kits():
    clear_scene()
    m_steel = make_solid_mat("KitDarkSteel", 0x0f172a, metallic=0.86, roughness=0.26)
    m_titanium = make_solid_mat("KitTitanium", 0xe2e8f0, metallic=0.82, roughness=0.22)
    m_cyan = make_solid_mat("KitCyanGlow", 0x22d3ee, metallic=0.25, roughness=0.18, emission_hex=0x22d3ee, emission_strength=0.85)
    m_red = make_solid_mat("KitCrimsonArmor", 0xe11d48, metallic=0.76, roughness=0.24, emission_hex=0xf43f5e, emission_strength=0.45)
    m_violet = make_solid_mat("KitVioletGlow", 0xa855f7, metallic=0.35, roughness=0.20, emission_hex=0xc084fc, emission_strength=0.85)
    m_gold = make_solid_mat("KitGold", 0xfbbf24, metallic=0.90, roughness=0.18, emission_hex=0xfbbf24, emission_strength=0.55)

    # ---------------------------------------------------------------------
    # Kit 1: STRIKER-0 — Freedom Aero-Binder Gundam Pack + Katana Pauldrons
    # ---------------------------------------------------------------------
    k1 = bpy.data.objects.new("Kit_Striker", None)
    bpy.context.scene.collection.objects.link(k1)
    # Front Sculpted Gundam Chest Vents (+Y) & Shoulder Blade Pauldrons
    make_child_part("S_ChestArmor", 'box', (0.52, 0.16, 0.30), m_titanium, k1, loc=(0, 0.24, -0.02), bevel=0.03)
    make_child_part("S_ChestCore", 'box', (0.20, 0.12, 0.18), m_cyan, k1, loc=(0, 0.30, 0.0), bevel=0.02)
    for sx in (-1, 1):
        make_child_part(f"S_Pauldron_{sx}", 'box', (0.34, 0.36, 0.24), m_titanium, k1, loc=(sx * 0.40, 0.06, 0.18), rot=(0, sx * 0.28, 0), bevel=0.03)
        make_child_part(f"S_PauldronTip_{sx}", 'box', (0.26, 0.10, 0.09), m_cyan, k1, loc=(sx * 0.52, 0.08, 0.26), rot=(0, sx * 0.35, 0), bevel=0.015)
        # Side Waist High-Frequency Katana Sheaths pointing back/down (-Y)
        make_child_part(f"S_Sheath_{sx}", 'box', (0.08, 0.92, 0.12), m_steel, k1, loc=(sx * 0.36, -0.22, -0.32), rot=(-0.38, 0, sx * 0.18), bevel=0.015)
        make_child_part(f"S_Hilt_{sx}", 'box', (0.10, 0.24, 0.10), m_gold, k1, loc=(sx * 0.32, 0.24, -0.14), rot=(-0.38, 0, sx * 0.18), bevel=0.015)

    # Dorsal Backpack (-Y)
    make_child_part("S_Backpack", 'box', (0.50, 0.32, 0.56), m_steel, k1, loc=(0, -0.24, 0.02), bevel=0.04)
    make_child_part("S_Spine", 'box', (0.16, 0.18, 0.64), m_gold, k1, loc=(0, -0.36, 0.06), bevel=0.02)

    # 4 Articulated Aero-Wing Binders (Striker_WingUL, UR, LL, LR) on Back (-Y)
    for side_tag, sx in (("L", -1), ("R", 1)):
        w_u = bpy.data.objects.new(f"Striker_WingU{side_tag}", None)
        w_u.parent = k1
        w_u.location = (sx * 0.22, -0.30, 0.18)
        w_u.rotation_euler = (-0.16, -sx * 0.40, -sx * 0.18)
        bpy.context.scene.collection.objects.link(w_u)
        make_child_part(f"SWU_Frame_{side_tag}", 'box', (1.05, 0.09, 0.16), m_titanium, w_u, loc=(sx * 0.52, 0, 0.06), bevel=0.02)
        make_child_part(f"SWU_Blade_{side_tag}", 'box', (1.28, 0.05, 0.22), m_cyan, w_u, loc=(sx * 0.68, -0.02, -0.06), bevel=0.015)

        w_l = bpy.data.objects.new(f"Striker_WingL{side_tag}", None)
        w_l.parent = k1
        w_l.location = (sx * 0.20, -0.28, -0.08)
        w_l.rotation_euler = (-0.14, sx * 0.30, -sx * 0.12)
        bpy.context.scene.collection.objects.link(w_l)
        make_child_part(f"SWL_Frame_{side_tag}", 'box', (0.82, 0.08, 0.14), m_steel, w_l, loc=(sx * 0.42, 0, 0), bevel=0.015)
        make_child_part(f"SWL_Trim_{side_tag}", 'box', (0.94, 0.05, 0.12), m_gold, w_l, loc=(sx * 0.52, -0.02, -0.06), bevel=0.01)

    # Striker Head Gundam V-Fin Crown (Helm_Striker, centered at Head pivot!)
    h1 = bpy.data.objects.new("Helm_Striker", None)
    bpy.context.scene.collection.objects.link(h1)
    make_child_part("HS_Crest", 'box', (0.10, 0.34, 0.18), m_titanium, h1, loc=(0, 0.04, 0.22), bevel=0.015)
    make_child_part("HS_Gem", 'box', (0.12, 0.10, 0.12), m_cyan, h1, loc=(0, 0.20, 0.18), bevel=0.01)
    for sx in (-1, 1):
        make_child_part(f"HS_VFin_{sx}", 'box', (0.48, 0.06, 0.09), m_gold, h1, loc=(sx * 0.26, 0.20, 0.26), rot=(0, -sx * 0.48, 0), bevel=0.01)

    # ---------------------------------------------------------------------
    # Kit 2: AEGIS-IV — Heavy Fortress Armor + Twin 6-Tube Missile Pods
    # ---------------------------------------------------------------------
    k2 = bpy.data.objects.new("Kit_Aegis", None)
    bpy.context.scene.collection.objects.link(k2)
    make_child_part("A_ChestPlate", 'box', (0.62, 0.22, 0.36), m_red, k2, loc=(0, 0.25, -0.02), bevel=0.035)
    make_child_part("A_ChestGrille", 'box', (0.34, 0.12, 0.16), m_gold, k2, loc=(0, 0.33, 0.0), bevel=0.015)
    make_child_part("A_Backpack", 'box', (0.72, 0.40, 0.64), m_steel, k2, loc=(0, -0.28, 0.04), bevel=0.04)
    for sx in (-1, 1):
        # Fortress Shoulder Reactive Shields + Exhaust Stacks
        make_child_part(f"A_Shield_{sx}", 'box', (0.24, 0.52, 0.50), m_red, k2, loc=(sx * 0.50, 0.06, 0.14), rot=(0, sx * 0.16, 0), bevel=0.03)
        make_child_part(f"A_Bumper_{sx}", 'box', (0.26, 0.54, 0.10), m_gold, k2, loc=(sx * 0.52, 0.06, 0.36), rot=(0, sx * 0.16, 0), bevel=0.015)
        make_child_part(f"A_Stack_{sx}", 'cone', (0.09, 0.07, 0.48), m_steel, k2, loc=(sx * 0.24, -0.38, 0.48), rot=(-0.25, 0, 0), segs=8)

    for side_tag, sx in (("L", -1), ("R", 1)):
        pod = bpy.data.objects.new(f"Aegis_Pod{side_tag}", None)
        pod.parent = k2
        pod.location = (sx * 0.52, -0.04, 0.48)
        bpy.context.scene.collection.objects.link(pod)
        make_child_part(f"AP_Box_{side_tag}", 'box', (0.44, 0.52, 0.40), m_steel, pod, loc=(0, 0, 0), bevel=0.03)
        make_child_part(f"AP_Cap_{side_tag}", 'box', (0.46, 0.28, 0.10), m_red, pod, loc=(0, 0.02, 0.22), bevel=0.02)
        # 6 Individual Golden Warhead Tips facing +Y (Forward!)
        for wx in (-0.11, 0.11):
            for wz in (-0.09, 0.0, 0.09):
                make_child_part(f"AP_War_{side_tag}_{wx}_{wz}", 'cone', (0.048, 0.015, 0.12), m_gold, pod, loc=(wx, 0.28, wz), rot=(-math.pi / 2, 0, 0), segs=6)

    h2 = bpy.data.objects.new("Helm_Aegis", None)
    bpy.context.scene.collection.objects.link(h2)
    make_child_part("HA_Brow", 'box', (0.44, 0.28, 0.14), m_red, h2, loc=(0, 0.10, 0.20), bevel=0.02)
    for sx in (-1, 1):
        make_child_part(f"HA_Horn_{sx}", 'box', (0.08, 0.24, 0.24), m_gold, h2, loc=(sx * 0.22, 0.12, 0.26), rot=(0.25, -sx * 0.22, 0), bevel=0.015)

    # ---------------------------------------------------------------------
    # Kit 3: NEXUS-9 — 6 Independent Floating Fin-Funnel Dragoons + Halo
    # ---------------------------------------------------------------------
    k3 = bpy.data.objects.new("Kit_Nexus", None)
    bpy.context.scene.collection.objects.link(k3)
    make_child_part("N_ChestPlate", 'box', (0.50, 0.16, 0.30), m_steel, k3, loc=(0, 0.24, -0.02), bevel=0.03)
    make_child_part("N_ChestOrb", 'sphere', (0.11, 0.09, 0.11), m_violet, k3, loc=(0, 0.31, 0.0))
    for sx in (-1, 1):
        make_child_part(f"N_Pauldron_{sx}", 'box', (0.32, 0.32, 0.22), m_steel, k3, loc=(sx * 0.40, 0.04, 0.18), rot=(0, sx * 0.32, 0), bevel=0.025)
        make_child_part(f"N_PauldronCrystal_{sx}", 'cone', (0.09, 0.02, 0.28), m_violet, k3, loc=(sx * 0.50, 0.04, 0.28), rot=(0, sx * 0.55, 0), segs=5)

    # Rotating Dorsal Quantum Halo Ring (Nexus_Halo) on Back (-Y)
    halo = bpy.data.objects.new("Nexus_Halo", None)
    halo.parent = k3
    halo.location = (0, -0.34, 0.14)
    bpy.context.scene.collection.objects.link(halo)
    make_child_part("NH_Core", 'cone', (0.24, 0.24, 0.12), m_steel, halo, loc=(0, 0, 0), rot=(math.pi / 2, 0, 0), segs=8)
    for r_i in range(6):
        ra = r_i * (math.tau / 6)
        make_child_part(
            f"NH_Seg_{r_i}", 'box', (0.28, 0.06, 0.08), m_gold, halo,
            loc=(math.cos(ra) * 0.46, 0, math.sin(ra) * 0.46),
            rot=(0, -ra, 0), bevel=0.01
        )

    # 6 Independent Fin-Funnel Dragoons (Nexus_Funnel_0 .. Nexus_Funnel_5)
    for fi in range(6):
        ang = (fi / 6.0) * math.tau
        f_piv = bpy.data.objects.new(f"Nexus_Funnel_{fi}", None)
        f_piv.parent = k3
        f_piv.location = (math.cos(ang) * 0.92, -0.36, 0.18 + math.sin(ang) * 0.62)
        bpy.context.scene.collection.objects.link(f_piv)

        make_child_part(f"NF_Body_{fi}", 'box', (0.14, 0.16, 0.88), m_steel, f_piv, loc=(0, 0, 0), bevel=0.02)
        make_child_part(f"NF_Core_{fi}", 'box', (0.08, 0.18, 0.68), m_violet if fi % 2 == 0 else m_cyan, f_piv, loc=(0, 0.02, 0), bevel=0.01)
        make_child_part(f"NF_TipU_{fi}", 'cone', (0.09, 0.015, 0.26), m_gold, f_piv, loc=(0, 0, 0.54), segs=4)
        make_child_part(f"NF_TipL_{fi}", 'cone', (0.08, 0.015, 0.22), m_gold, f_piv, loc=(0, 0, -0.52), rot=(math.pi, 0, 0), segs=4)

    h3 = bpy.data.objects.new("Helm_Nexus", None)
    bpy.context.scene.collection.objects.link(h3)
    make_child_part("HN_Crown", 'cone', (0.09, 0.015, 0.36), m_violet, h3, loc=(0, 0.16, 0.30), rot=(-0.22, 0, 0), segs=5)
    for sx in (-1, 1):
        make_child_part(f"HN_Ear_{sx}", 'box', (0.34, 0.06, 0.09), m_gold, h3, loc=(sx * 0.24, 0.16, 0.24), rot=(0, -sx * 0.55, 0), bevel=0.01)

    export_glb(os.path.join(MODEL_DIR, "mech_armory.glb"))


# =========================================================================
# 4. Upgraded Stage Landmarks & Twin-Turbine Sniper Drone (stage_landmarks.glb)
# =========================================================================
def build_stage_landmarks_and_sniper():
    clear_scene()
    mat = make_vcol_pbr_mat("StageDroneVCol", metallic=0.72, roughness=0.28, emission_strength=0.58)

    # 1. Prop_FoundryCore
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 1.08, 0.90, 0.42, 0x27130e, loc=(0, 0, 0.21), segs=8)
    add_cone_vc(bm, col, 0.56, 0.56, 2.55, 0xff5500, loc=(0, 0, 1.55), segs=12)
    for hz in (0.95, 1.55, 2.15):
        add_cone_vc(bm, col, 0.70, 0.70, 0.16, 0xfde047, loc=(0, 0, hz), segs=12)
    add_cone_vc(bm, col, 0.86, 0.48, 0.48, 0x1c1917, loc=(0, 0, 2.98), segs=8)
    for k in range(4):
        ang = k * (math.pi / 2) + math.pi / 4
        add_box_vc(bm, col, 0.18, 0.30, 2.70, 0x431407, loc=(math.cos(ang) * 0.74, math.sin(ang) * 0.74, 1.58), rot=(0, 0, ang), bevel=0.025)
    finalize_vcol_obj("Prop_FoundryCore", bm, mat)

    # 2. Prop_CryoObelisk
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.98, 0.78, 0.36, 0x0f172a, loc=(0, 0, 0.18), segs=6)
    add_cone_vc(bm, col, 0.56, 0.03, 2.25, 0x67e8f9, loc=(0, 0, 2.10), segs=6)
    add_cone_vc(bm, col, 0.56, 0.04, 0.88, 0x38bdf8, loc=(0, 0, 0.62), rot=(math.pi, 0, 0), segs=6)
    for k in range(4):
        ang = k * (math.tau / 4)
        add_cone_vc(bm, col, 0.22, 0.02, 1.12, 0xc084fc, loc=(math.cos(ang) * 0.70, math.sin(ang) * 0.70, 1.32), rot=(0.20 * math.sin(ang), -0.20 * math.cos(ang), 0), segs=5)
    finalize_vcol_obj("Prop_CryoObelisk", bm, mat)

    # 3. Prop_HackBeacon
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_cone_vc(bm, col, 0.94, 0.76, 0.28, 0x1e293b, loc=(0, 0, 0.14), segs=8)
    add_cone_vc(bm, col, 0.28, 0.18, 2.15, 0x334155, loc=(0, 0, 1.25), segs=8)
    add_cone_vc(bm, col, 0.38, 0.38, 0.52, 0x22d3ee, loc=(0, 0, 1.55), segs=8)
    for k in range(3):
        a = k * (math.tau / 3)
        add_box_vc(bm, col, 0.10, 0.42, 0.55, 0x0f172a, loc=(math.cos(a) * 0.48, math.sin(a) * 0.48, 0.62), rot=(0, 0, a), bevel=0.015)
    add_box_vc(bm, col, 1.18, 0.16, 0.38, 0xfbbf24, loc=(0, 0, 2.40), rot=(0.35, 0, 0), bevel=0.02)
    add_cone_vc(bm, col, 0.22, 0.02, 0.58, 0xfef08a, loc=(0, 0, 2.78), segs=6)
    finalize_vcol_obj("Prop_HackBeacon", bm, mat)

    # 4. Enemy_SniperDrone — Twin-Turbine Stealth Rail-Sniper Recon Drone (-Y Forward!)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_box_vc(bm, col, 0.54, 0.84, 0.30, 0x1e1b4b, loc=(0, 0.06, 0.98), bevel=0.04)
    add_box_vc(bm, col, 0.34, 0.48, 0.14, 0x4338ca, loc=(0, 0.12, 1.16), bevel=0.025)
    # Front Triple-Optic Targeting Pod + Coiled Railgun Barrel (-Y)
    add_sphere_vc(bm, col, 0.16, 0.14, 0.14, 0xf43f5e, loc=(0, -0.38, 1.00), subdiv=1)
    add_cone_vc(bm, col, 0.085, 0.05, 1.02, 0x334155, loc=(0, -0.68, 0.84), rot=(math.pi / 2, 0, 0), segs=8)
    for cy in (-0.52, -0.78, -1.04):
        add_cone_vc(bm, col, 0.11, 0.11, 0.07, 0xfef08a, loc=(0, cy, 0.84), rot=(math.pi / 2, 0, 0), segs=8)
    # Swept Gull-Wings + Twin Ducted-Fan Thruster Nacelles
    for sx in (-1, 1):
        add_box_vc(bm, col, 0.68, 0.38, 0.08, 0x312e81, loc=(sx * 0.54, 0.10, 1.00), rot=(0, -sx * 0.18, sx * 0.28), bevel=0.02)
        add_cone_vc(bm, col, 0.18, 0.16, 0.22, 0x0f172a, loc=(sx * 0.84, 0.14, 0.96), segs=10)
        add_cone_vc(bm, col, 0.13, 0.13, 0.24, 0x22d3ee, loc=(sx * 0.84, 0.14, 0.95), segs=10)
        add_box_vc(bm, col, 0.56, 0.08, 0.09, 0xf43f5e, loc=(sx * 0.52, -0.08, 1.03), rot=(0, -sx * 0.18, sx * 0.28), bevel=0.01)
    finalize_vcol_obj("Enemy_SniperDrone", bm, mat)

    export_glb(os.path.join(MODEL_DIR, "stage_landmarks.glb"))


# =========================================================================
# 5. Re-Render Upgraded Hero Mecha Portraits (192x192 Cycles RGBA)
# =========================================================================
def render_hd_mech_portraits():
    clear_scene()
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 26
    scn.cycles.use_denoising = False
    scn.render.resolution_x = 192
    scn.render.resolution_y = 192
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'

    world = bpy.data.worlds.new("PortraitWorld")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.04, 0.10, 1.0)
        bg.inputs[1].default_value = 0.95

    cam_data = bpy.data.cameras.new("StudioCam")
    cam_data.lens = 58
    cam = bpy.data.objects.new("StudioCam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.location = (2.25, -2.55, 1.72)
    cam.rotation_euler = (Vector((0, 0, 0.08)) - cam.location).to_track_quat('-Z', 'Y').to_euler()

    for name, loc, energy, hex_c in (
        ("Key", (2.8, -2.4, 3.2), 155, 0xffffff),
        ("Rim", (-2.8, 1.8, 2.2), 125, 0x38bdf8),
        ("Fill", (1.8, 2.6, -1.0), 95, 0xc084fc),
    ):
        ld = bpy.data.lights.new(name=name, type='AREA')
        ld.energy = energy
        ld.size = 2.1
        c = hex_rgba(hex_c)
        ld.color = (c[0], c[1], c[2])
        lo = bpy.data.objects.new(name, ld)
        scn.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0)) - lo.location).to_track_quat('-Z', 'Y').to_euler()

    root = bpy.data.objects.new("BustRoot", None)
    scn.collection.objects.link(root)

    m_steel = make_solid_mat("PSteel", 0x1e293b, 0.88, 0.22)
    m_titanium = make_solid_mat("PTit", 0xe2e8f0, 0.84, 0.20)
    m_gold = make_solid_mat("PGold", 0xfbbf24, 0.92, 0.16, 0xf59e0b, 0.8)
    m_cyan = make_solid_mat("PCyan", 0x22d3ee, 0.25, 0.15, 0x22d3ee, 2.4)
    m_red = make_solid_mat("PRed", 0xe11d48, 0.72, 0.20, 0xf43f5e, 1.1)
    m_violet = make_solid_mat("PViolet", 0xa855f7, 0.30, 0.16, 0xc084fc, 2.4)

    def clear_bust():
        for ch in list(root.children):
            m = ch.data
            bpy.data.objects.remove(ch, do_unlink=True)
            if m and isinstance(m, bpy.types.Mesh):
                bpy.data.meshes.remove(m, do_unlink=True)

    for m_id, m_acc in (("striker", m_cyan), ("aegis", m_red), ("nexus", m_violet)):
        clear_bust()
        chest_m = m_titanium if m_id == "striker" else (m_red if m_id == "aegis" else m_steel)
        make_child_part("Torso", 'box', (0.94, 0.58, 0.68), chest_m, root, loc=(0, 0, -0.24), bevel=0.05)
        make_child_part("Collar", 'box', (0.62, 0.44, 0.16), m_gold, root, loc=(0, -0.04, 0.12), bevel=0.025)
        make_child_part("Core", 'box', (0.36, 0.16, 0.26), m_gold if m_id == "aegis" else m_acc, root, loc=(0, -0.28, -0.20), bevel=0.02)
        make_child_part("Helm", 'box', (0.48, 0.50, 0.44), m_steel, root, loc=(0, -0.04, 0.40), bevel=0.045)
        make_child_part("Visor", 'box', (0.42, 0.12, 0.12), m_gold if m_id == "striker" else m_acc, root, loc=(0, -0.27, 0.41), bevel=0.015)

        if m_id == "striker":
            for sx in (-1, 1):
                make_child_part(f"Pauld_{sx}", 'box', (0.38, 0.46, 0.30), m_titanium, root, loc=(sx * 0.64, 0, -0.06), rot=(0, -sx * 0.28, 0), bevel=0.03)
                make_child_part(f"WingU_{sx}", 'box', (1.05, 0.08, 0.24), m_cyan, root, loc=(sx * 0.72, 0.32, 0.22), rot=(0.22, -sx * 0.44, 0), bevel=0.015)
                make_child_part(f"WingL_{sx}", 'box', (0.82, 0.07, 0.16), m_gold, root, loc=(sx * 0.58, 0.34, -0.14), rot=(0.18, sx * 0.30, 0), bevel=0.01)
                make_child_part(f"VFin_{sx}", 'box', (0.48, 0.07, 0.10), m_gold, root, loc=(sx * 0.28, -0.26, 0.64), rot=(0, -sx * 0.46, 0), bevel=0.01)
        elif m_id == "aegis":
            for sx in (-1, 1):
                make_child_part(f"Shield_{sx}", 'box', (0.32, 0.56, 0.48), m_steel, root, loc=(sx * 0.68, 0, -0.06), rot=(0, -sx * 0.18, 0), bevel=0.03)
                make_child_part(f"Pod_{sx}", 'box', (0.42, 0.48, 0.38), m_red, root, loc=(sx * 0.64, 0.08, 0.32), bevel=0.03)
                make_child_part(f"War_{sx}", 'box', (0.32, 0.12, 0.28), m_gold, root, loc=(sx * 0.64, -0.16, 0.32), bevel=0.015)
                make_child_part(f"Horn_{sx}", 'box', (0.09, 0.22, 0.24), m_gold, root, loc=(sx * 0.24, -0.18, 0.62), rot=(-0.2, -sx * 0.25, 0), bevel=0.015)
        else:
            make_child_part("Crown", 'cone', (0.10, 0.02, 0.36), m_violet, root, loc=(0, -0.22, 0.68), segs=5)
            for fi in range(6):
                fa = (fi / 6.0) * math.tau
                make_child_part(
                    f"Funnel_{fi}", 'box', (0.13, 0.14, 0.78), m_violet if fi % 2 == 0 else m_gold, root,
                    loc=(math.cos(fa) * 0.86, 0.34, 0.08 + math.sin(fa) * 0.56),
                    rot=(0.15, -math.sin(fa) * 0.35, math.cos(fa) * 0.35), bevel=0.015
                )

        scn.render.filepath = os.path.join(UI_DIR, f"mech_{m_id}.png")
        bpy.ops.render.render(write_still=True)
        print(f"Rendered HD portrait: mech_{m_id}.png")


if __name__ == "__main__":
    build_enemy_mechs()
    build_boss_titan()
    build_player_mech_kits()
    build_stage_landmarks_and_sniper()
    render_hd_mech_portraits()
    print("=== ALL HD MECHA, ENEMY, BOSS, LANDMARKS & PORTRAITS EXPORTED ===")
