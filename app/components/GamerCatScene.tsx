"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function GamerCatScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 480;
    const height = mount.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    scene.fog = new THREE.Fog(0x0a0e17, 7, 16);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0.15, 1.85, 5.4);
    camera.lookAt(0, 1.15, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimCyan = new THREE.PointLight(0x3ee8f0, 1.4, 12);
    rimCyan.position.set(-2.5, 2, 1);
    scene.add(rimCyan);
    const rimViolet = new THREE.PointLight(0xa78bfa, 1.1, 12);
    rimViolet.position.set(2.5, 1.5, -1);
    scene.add(rimViolet);

    const cat = new THREE.Group();
    scene.add(cat);

    const fur = new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.88 });
    const furPatch = new THREE.MeshStandardMaterial({ color: 0xe6e6dc, roughness: 0.92 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xff8fab, roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.8), fur);
    body.position.y = 0.95;
    body.castShadow = true;
    cat.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.64, 28, 28), fur);
    head.position.set(0, 1.78, 0.12);
    head.scale.set(1.08, 0.98, 1.1);
    head.castShadow = true;
    cat.add(head);

    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.38, 8), fur);
    earL.position.set(-0.36, 2.28, 0.02);
    earL.rotation.z = 0.3;
    cat.add(earL);

    const earR = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 8), furPatch);
    earR.position.set(0.4, 2.05, 0.12);
    earR.rotation.z = -0.7;
    earR.rotation.x = 0.35;
    cat.add(earR);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), black);
    eyeL.position.set(-0.23, 1.84, 0.54);
    cat.add(eyeL);

    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 12), black);
    eyeR.position.set(0.21, 1.79, 0.52);
    cat.add(eyeR);

    const eyeGlitch = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x3ee8f0 }),
    );
    eyeGlitch.position.set(0.26, 1.86, 0.6);
    cat.add(eyeGlitch);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 10), pink);
    nose.position.set(0.02, 1.66, 0.6);
    cat.add(nose);

    const headsetBand = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.045, 8, 28, Math.PI),
      black,
    );
    headsetBand.position.set(0, 2.08, 0);
    headsetBand.rotation.x = Math.PI / 2;
    cat.add(headsetBand);

    const cupMatL = new THREE.MeshStandardMaterial({
      color: 0x3ee8f0,
      emissive: 0x3ee8f0,
      emissiveIntensity: 0.85,
      roughness: 0.3,
    });
    const cupMatR = cupMatL.clone();
    const cupL = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.13, 16), cupMatL);
    cupL.rotation.z = Math.PI / 2;
    cupL.position.set(-0.6, 1.96, 0);
    cat.add(cupL);
    const cupR = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.13, 16), cupMatR);
    cupR.rotation.z = Math.PI / 2;
    cupR.position.set(0.6, 1.96, 0);
    cat.add(cupR);

    const mic = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), black);
    mic.position.set(0.12, 1.52, 0.62);
    mic.rotation.x = 0.4;
    cat.add(mic);

    const legGeo = new THREE.BoxGeometry(0.24, 0.48, 0.24);
    const legFL = new THREE.Mesh(legGeo, fur);
    legFL.position.set(-0.38, 0.54, 0.28);
    cat.add(legFL);
    const legFR = new THREE.Mesh(legGeo, furPatch);
    legFR.position.set(0.36, 0.32, 0.28);
    cat.add(legFR);
    const legBL = new THREE.Mesh(legGeo, fur);
    legBL.position.set(-0.38, 0.54, -0.22);
    cat.add(legBL);
    const legBR = new THREE.Mesh(legGeo, fur);
    legBR.position.set(0.36, 0.54, -0.22);
    cat.add(legBR);

    const tail = new THREE.Group();
    const tail1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.52), fur);
    tail1.position.z = -0.58;
    tail.add(tail1);
    const tail2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.38), furPatch);
    tail2.position.set(0.12, 0.18, -0.92);
    tail2.rotation.y = 0.9;
    tail.add(tail2);
    tail.position.set(0.05, 1.12, -0.38);
    cat.add(tail);

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.09, 0.75),
      new THREE.MeshStandardMaterial({ color: 0x141c2e }),
    );
    desk.position.set(0, 0.64, 0.58);
    cat.add(desk);

    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.07, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x0a0e17 }),
    );
    keyboard.position.set(0, 0.72, 0.58);
    cat.add(keyboard);

    const keyGlowMat = new THREE.MeshStandardMaterial({
      color: 0xa78bfa,
      emissive: 0xa78bfa,
      emissiveIntensity: 0.9,
    });
    const keyGlow = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.025, 0.06), keyGlowMat);
    keyGlow.position.set(0, 0.77, 0.4);
    cat.add(keyGlow);

    const energyDrink = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d, emissiveIntensity: 0.3 }),
    );
    energyDrink.position.set(0.75, 0.82, 0.55);
    cat.add(energyDrink);

    const errorBadge = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.09, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0xff5555,
        emissive: 0xff2222,
        emissiveIntensity: 0.7,
      }),
    );
    errorBadge.position.set(0.18, 1.14, 0.44);
    cat.add(errorBadge);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({ color: 0x0f1524, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const rgbStripMat = new THREE.MeshStandardMaterial({
      color: 0x3ee8f0,
      emissive: 0x3ee8f0,
      emissiveIntensity: 0.85,
    });
    const rgbStrip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.025, 0.1), rgbStripMat);
    rgbStrip.position.set(0, 0.012, 1.25);
    scene.add(rgbStrip);

    const rgbMaterials = [cupMatL, cupMatR, keyGlowMat, rgbStripMat];

    let frame = 0;
    let animId = 0;

    const onResize = () => {
      const w = mount.clientWidth || 480;
      const h = mount.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const animate = () => {
      frame += 1;
      const t = frame * 0.02;

      cat.position.y = Math.sin(t * 0.65) * 0.035;
      cat.rotation.y = Math.sin(t * 0.32) * 0.09;
      head.rotation.z = Math.sin(t * 0.45) * 0.05;
      head.rotation.x = Math.sin(t * 0.28) * 0.03;
      tail.rotation.y = Math.sin(t * 1.4) * 0.4;
      earR.rotation.z = -0.7 + Math.sin(t * 2.1) * 0.06;
      eyeR.scale.setScalar(1 + Math.sin(t * 2.8) * 0.06);
      legFR.position.y = 0.32 + Math.sin(t * 1.1) * 0.02;

      const hue = (frame * 0.007) % 1;
      const rgb = new THREE.Color().setHSL(hue, 0.92, 0.52);
      rgbMaterials.forEach((mat) => {
        mat.color.copy(rgb);
        mat.emissive.copy(rgb);
      });

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    };
  }, []);

  return <div ref={mountRef} className="gamer-cat-canvas" aria-hidden />;
}
