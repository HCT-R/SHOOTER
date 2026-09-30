/* Pixel-art presentation: sample geometry above the final art resolution,
   shade on a fixed pixel grid, then display whole pixels without filtering.
   Colour, silhouettes and surface creases have separate jobs; texture noise
   is not mistaken for an outline. The DOM interface retains its resolution. */
class PixelRenderer {
  constructor(renderer, pixelSize = 2) {
    this.renderer = renderer;
    this.width = 1; this.height = 1;
    this.logicalWidth = 1; this.logicalHeight = 1;
    this.renderScale = 2;
    this.pixelSize = 0;
    const hdr = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      type: hdr, depthBuffer: true, stencilBuffer: false, generateMipmaps: false
    });
    this.target.depthTexture = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    this.detailTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false
    });
    this.uniforms = {
      sceneMap: { value: this.target.texture },
      depthMap: { value: this.target.depthTexture },
      texel: { value: new THREE.Vector2(1, 1) },
      sourceSize: { value: new THREE.Vector2(1, 1) },
      cameraRange: { value: new THREE.Vector2(0.1, 260) },
      perspective: { value: 1 },
      toneMappingExposure: { value: renderer.toneMappingExposure },
      reveal: { value: 1 }
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      // Store straight alpha; only the final pass blends onto the preview.
      blending: THREE.NoBlending,
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D sceneMap;
        uniform sampler2D depthMap;
        uniform vec2 texel;
        uniform vec2 sourceSize;
        uniform vec2 cameraRange;
        uniform float perspective;
        uniform float reveal;
        varying vec2 vUv;
        #include <tonemapping_pars_fragment>
        float viewDepth(vec2 uv) {
          float d = texture2D(depthMap, uv).r;
          float n = cameraRange.x, f = cameraRange.y;
          return mix(n + d * (f - n), n * f / (f - d * (f - n)), perspective);
        }
        vec4 artSample(vec2 uv) {
          // Four sub-pixel samples retain narrow barrels and armour details.
          vec2 q = texel * 0.25;
          vec4 a = texture2D(sceneMap, uv + vec2(-q.x, -q.y));
          vec4 b = texture2D(sceneMap, uv + vec2( q.x, -q.y));
          vec4 c = texture2D(sceneMap, uv + vec2(-q.x,  q.y));
          vec4 d = texture2D(sceneMap, uv + vec2( q.x,  q.y));
          float alpha = a.a + b.a + c.a + d.a;
          // Transparent draws in the scene buffer are already premultiplied.
          return vec4((a.rgb + b.rgb + c.rgb + d.rgb) / max(alpha, 0.0001), alpha * 0.25);
        }
        void main() {
          vec2 uv = (floor(vUv * sourceSize) + 0.5) * texel;
          vec4 colour = artSample(uv);
          float z = viewDepth(uv);
          float zl = viewDepth(uv - vec2(texel.x, 0.0));
          float zr = viewDepth(uv + vec2(texel.x, 0.0));
          float zu = viewDepth(uv + vec2(0.0, texel.y));
          float zd = viewDepth(uv - vec2(0.0, texel.y));
          float threshold = max(0.12, z * 0.009);
          float silhouette = step(threshold, max(max(zl-z, zr-z), max(zu-z, zd-z)));
          // Second differences cancel sloping flat floors, leaving creases.
          float crease = max(abs(zl + zr - 2.0*z), abs(zu + zd - 2.0*z));
          float bevel = step(threshold * 0.45, crease) * (1.0 - silhouette);
          float solid = step(z, cameraRange.y * 0.985);
          // Render targets bypass Three's display transform. Apply it once
          // here before art grading; the final presentation copies the result.
          vec3 c = sRGBTransferOETF(vec4(ACESFilmicToneMapping(colour.rgb), 1.0)).rgb;
          float light = luminance(c);
          // Quantize light, preserving authored hues and denser shadow steps.
          float ramp = pow(light, 0.72);
          float level = pow(floor(ramp * 18.0 + 0.5) / 18.0, 1.0 / 0.72);
          c *= mix(1.0, level / max(light, 0.001), 0.88);
          float shadow = (1.0 - smoothstep(0.06, 0.38, light)) * solid;
          c += vec3(0.008, 0.013, 0.023) * shadow;
          // Coloured one-pixel ink. Emissive cores stay bright.
          float ink = silhouette * solid * (1.0 - smoothstep(0.72, 0.96, light));
          c = mix(c, c * vec3(0.53, 0.62, 0.73), ink * 0.7);
          c += vec3(0.035, 0.044, 0.05) * bevel * solid * (1.0 - light);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0) * reveal, colour.a);
        }`
    });
    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        artMap: { value: this.detailTarget.texture },
        artSize: { value: new THREE.Vector2(1, 1) },
        outputSize: { value: new THREE.Vector2(1, 1) },
        viewSize: { value: new THREE.Vector2(1, 1) },
        pixelSize: { value: 2 }
      },
      depthTest: false, depthWrite: false, toneMapped: false,
      transparent: !!renderer.getContext().getContextAttributes().alpha,
      vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D artMap;
        uniform vec2 artSize, outputSize, viewSize;
        uniform float pixelSize;
        void main() {
          // Crop the last partial row/column instead of stretching odd sizes.
          vec2 cell = floor(gl_FragCoord.xy * viewSize / outputSize / pixelSize);
          gl_FragColor = texture2D(artMap, (cell + 0.5) / artSize);
        }`
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.setPixelSize(pixelSize);
  }

  setPixelSize(value) {
    const n = Number(value);
    this.pixelSize = [0, 2, 3, 4, 6].includes(n) ? n : 2;
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const step = this.pixelSize || 2;
    const w = this.logicalWidth = Math.max(1, Math.ceil(this.width / step));
    const h = this.logicalHeight = Math.max(1, Math.ceil(this.height / step));
    if (this.target.width !== w * this.renderScale || this.target.height !== h * this.renderScale) {
      this.target.setSize(w * this.renderScale, h * this.renderScale);
    }
    if (this.detailTarget.width !== w || this.detailTarget.height !== h) this.detailTarget.setSize(w, h);
    this.uniforms.texel.value.set(1 / w, 1 / h);
    this.uniforms.sourceSize.value.set(w, h);
    this.presentMaterial.uniforms.artSize.value.set(w, h);
    this.presentMaterial.uniforms.viewSize.value.set(this.width, this.height);
    this.presentMaterial.uniforms.pixelSize.value = step;
  }

  render(scene, camera) {
    const renderer = this.renderer;
    if (!this.pixelSize) { renderer.render(scene, camera); return; }
    const previousTarget = renderer.getRenderTarget();
    const autoReset = renderer.info.autoReset;
    if (autoReset) renderer.info.reset();
    renderer.info.autoReset = false;
    this.uniforms.cameraRange.value.set(camera.near, camera.far);
    this.uniforms.perspective.value = camera.isPerspectiveCamera ? 1 : 0;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    const output = this.presentMaterial.uniforms.outputSize.value;
    if (previousTarget) output.set(previousTarget.width, previousTarget.height);
    else renderer.getDrawingBufferSize(output);
    try {
      renderer.setRenderTarget(this.target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(this.detailTarget);
      this.quad.material = this.material;
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(previousTarget);
      this.quad.material = this.presentMaterial;
      renderer.render(this.scene, this.camera);
    } finally {
      this.quad.material = this.material;
      renderer.setRenderTarget(previousTarget);
      renderer.info.autoReset = autoReset;
    }
  }

  dispose() {
    this.target.dispose(); this.detailTarget.dispose(); this.quad.geometry.dispose();
    this.material.dispose(); this.presentMaterial.dispose();
  }
}
