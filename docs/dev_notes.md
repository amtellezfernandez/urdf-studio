⭐ 1. BOX (Axis-Aligned Bounding Box)

Compute mesh bounding box:

min = (min x_i, min y_i, min z_i)
max = (max x_i, max y_i, max z_i)
bbox = max - min

Auto-fill box size:
size_x = bbox.x
size_y = bbox.y
size_z = bbox.z

Auto-fill origin:
origin_xyz = (min + max) / 2
origin_rpy = (0,0,0)


Works only for axis-aligned boxes (typical URDF case).

⭐ 2. SPHERE (minimum bounding sphere)
Make sphere radius = max distance to centroid

Compute centroid:

C = mean(v_i)


Radius:

r = max( ||v_i - C|| )

Auto-fill sphere params:
radius = r
origin_xyz = C
origin_rpy = (0,0,0)


(You can use Welzl’s algorithm for minimal enclosing sphere, but the centroid approach is fine.)

⭐ 3. CYLINDER (fit around principal axis)

Use PCA to find principal axis:

covariance matrix = Σ (v_i - mean)(v_i - mean)^T
eigenvectors = PCA(covariance)
axis = eigenvector with largest eigenvalue

Project vertices onto this axis:
t_i = dot(v_i, axis)
height = max(t_i) - min(t_i)

Compute radius (max orthogonal distance):

For each point:

dist_i = norm( (v_i - mean) - dot(v_i - mean, axis)*axis )
radius = max(dist_i)

Auto-fill cylinder params:
length = height
radius = radius
origin_xyz = mean
origin_rpy = rotation that aligns URDF Z-axis with PCA axis


URDF assumes cylinder axis = Z.

So compute rotation R such that:

R * (0,0,1) = axis


Use quaternion or Rodrigues formula.

⭐ 4. CAPSULE (cylinder + hemispheres)

Same cylinder math as above:

length = height
radius = max radial distance


Capsule = cylinder + sphere caps.

No extra math needed.

URDF does not support capsules natively, but collision engines (Bullet/Ode) do if you export to SDF.

If implementing in URDF:

you approximate with mesh

or store as custom tag for your tool

⭐ 5. MESH (Collision Mesh = Visual Mesh)

If user selects “Mesh” collision:

filename = same as visual mesh
scale = same as visual mesh
origin_xyz = same
origin_rpy = same


Nothing fancy here.

⭐ 6. Oriented Bounding Box (optional advanced)

If you want better-fitting boxes than axis-aligned:

Compute PCA axes:

axis1, axis2, axis3 = PCA eigenvectors


Transform points into PCA coordinate frame.

Compute AABB in PCA frame.

Transform back to original frame.

URDF does NOT support oriented boxes directly.
You must rotate:

origin_rpy = rotation matrix of PCA axes


and then set box as axis-aligned in the local link frame.