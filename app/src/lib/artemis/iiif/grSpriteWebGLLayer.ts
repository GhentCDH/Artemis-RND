import maplibregl from "maplibre-gl";
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl";
import type { GrSpriteManifest } from "./grSpritePlaceholder";

const VERT = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  uniform mat4 u_matrix;
  varying vec2 v_uv;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    v_uv = a_uv;
  }
`;

const FRAG = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform float u_opacity;
  void main() {
    vec4 c = texture2D(u_texture, v_uv);
    gl_FragColor = vec4(c.rgb * u_opacity, c.a * u_opacity);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile error");
  return shader;
}

export class GrSpriteWebGLLayer implements CustomLayerInterface {
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  readonly id: string;

  private manifest: GrSpriteManifest;
  private sheetUrl: string;
  private opacity: number;

  private gl: WebGLRenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private vertexCount = 0;
  private ready = false;
  private matrixScratch = new Float32Array(16);

  private loc = {
    aPos: -1 as number,
    aUv: -1 as number,
    uMatrix: null as WebGLUniformLocation | null,
    uTexture: null as WebGLUniformLocation | null,
    uOpacity: null as WebGLUniformLocation | null,
  };

  constructor(id: string, manifest: GrSpriteManifest, sheetUrl: string, opacity = 0.85) {
    this.id = id;
    this.manifest = manifest;
    this.sheetUrl = sheetUrl;
    this.opacity = opacity;
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    this.gl = gl;

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) ?? "program link error");
    this.program = prog;

    this.loc.aPos = gl.getAttribLocation(prog, "a_pos");
    this.loc.aUv = gl.getAttribLocation(prog, "a_uv");
    this.loc.uMatrix = gl.getUniformLocation(prog, "u_matrix");
    this.loc.uTexture = gl.getUniformLocation(prog, "u_texture");
    this.loc.uOpacity = gl.getUniformLocation(prog, "u_opacity");

    this.loadTextureAndBuildBuffer(gl, map).catch(() => {});
  }

  private getProjectionMatrix(input: CustomRenderMethodInput | number[] | Float32Array | Float64Array): Float32Array {
    const matrix = Array.isArray(input) || input instanceof Float32Array || input instanceof Float64Array
      ? input
      : input.defaultProjectionData.mainMatrix;

    if (matrix instanceof Float32Array) return matrix;
    this.matrixScratch.set(matrix);
    return this.matrixScratch;
  }

  private async loadTextureAndBuildBuffer(gl: WebGLRenderingContext, map: maplibregl.Map): Promise<void> {
    const t0 = performance.now();
    const res = await fetch(this.sheetUrl);
    const blob = await res.blob();
    const t1 = performance.now();
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "default",
      premultiplyAlpha: "premultiply",
    });
    const t2 = performance.now();
    const { width: W, height: H } = bitmap;

    const canvases = Object.values(this.manifest.canvases);
    // 2 triangles × 3 verts × 4 floats per canvas
    const data = new Float32Array(canvases.length * 6 * 4);
    let o = 0;

    for (const c of canvases) {
      // coordinates is [NW, NE, SE, SW] in [lng, lat]
      const m = c.coordinates.map(([lng, lat]) => {
        const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
        return [mc.x, mc.y] as [number, number];
      });

      const u0 = c.x / W,           v0 = c.y / H;
      const u1 = (c.x + c.width) / W, v1 = (c.y + c.height) / H;

      // Triangle 1: NW, NE, SW  |  Triangle 2: NE, SE, SW
      const verts = [
        m[0][0], m[0][1], u0, v0, // NW
        m[1][0], m[1][1], u1, v0, // NE
        m[3][0], m[3][1], u0, v1, // SW
        m[1][0], m[1][1], u1, v0, // NE
        m[2][0], m[2][1], u1, v1, // SE
        m[3][0], m[3][1], u0, v1, // SW
      ];
      data.set(verts, o);
      o += verts.length;
    }

    this.vertexCount = canvases.length * 6;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    bitmap.close();

    this.texture = tex;
    this.ready = true;
    const t3 = performance.now();
    console.log(
      `[GrSpriteWebGL] ${Object.keys(this.manifest.canvases).length} tiles | ` +
      `fetch ${(t1 - t0).toFixed(0)}ms | bitmap ${(t2 - t1).toFixed(0)}ms | ` +
      `buffer+tex ${(t3 - t2).toFixed(0)}ms | total ${(t3 - t0).toFixed(0)}ms`
    );
    map.triggerRepaint();
  }

  render(gl: WebGLRenderingContext, input: CustomRenderMethodInput | number[] | Float32Array | Float64Array): void {
    if (!this.ready || !this.program || !this.vbo || !this.texture) return;

    const { aPos, aUv, uMatrix, uTexture, uOpacity } = this.loc;
    const STRIDE = 16; // 4 floats × 4 bytes
    const matrix = this.getProjectionMatrix(input);

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, STRIDE, 8);

    gl.uniformMatrix4fv(uMatrix, false, matrix);
    gl.uniform1f(uOpacity, this.opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(uTexture, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aUv);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext): void {
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.program) gl.deleteProgram(this.program);
    this.texture = null;
    this.vbo = null;
    this.program = null;
    this.ready = false;
  }
}
