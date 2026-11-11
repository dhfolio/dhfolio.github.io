// Browser port of /api/metadata + reference collection (js/localapi/owner/metadata.js, references.js).
// Offline: providers are answered from fixtures/metadata/*.json (raw responses recorded 2026-11-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lookupMetadata, extractDoi, extractArxivId, isArxivDoi, normalizePartialDateParts, normalizeIsoDateText,
  chooseMorePrecisePublicationDate, normalizeAbstract, normalizeJournalName, normalizePersonName,
  canonicalPersonName, mergeMetadata, pyQuote, pyUnquote, openalexAbstract,
} from "../../js/localapi/owner/metadata.js";
import { fetchReferences, enrichReference, toReferenceRows, utcTimestamp } from "../../js/localapi/owner/references.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "metadata");
const RECORDED = Object.assign({}, ...fs.readdirSync(FIX).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"))));

// The page CSP's connect-src (minus self / api.github.com, which this code never needs).
const CSP_HOSTS = new Set(["api.crossref.org", "api.openalex.org", "api.semanticscholar.org", "api.datacite.org", "doi.org", "data.crossref.org", "researchatlas.io"]);

function fixtureFetch({ records = RECORDED, failing = [] } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    assert.ok(CSP_HOSTS.has(new URL(url).hostname), `host outside CSP: ${url}`);
    assert.equal(init.credentials, "omit", "requests must not send cookies");
    assert.equal(init.headers, undefined, "no custom headers (no Authorization, no User-Agent)");
    if (failing.includes(url)) throw new TypeError("Failed to fetch");
    const rec = records[url];
    if (!rec) throw new TypeError(`Failed to fetch (no fixture for ${url})`);
    const text = typeof rec.body === "string" ? rec.body : JSON.stringify(rec.body);
    return { ok: rec.status >= 200 && rec.status < 300, status: rec.status, statusText: rec.statusText, json: async () => JSON.parse(text), text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

// ---- goldens: researchatlas.io /api/metadata output captured 2026-11-10 ----
// prettier-ignore
const GOLDENS = [
  {"query":"10.1038/s41928-026-01694-1","body":{"doi":"10.1038/s41928-026-01694-1","title":"Ferroelectricity in six-ångström-thick two-dimensional gallium oxide","authors":["Tong Jiang","Han Chen","Yubo Yuan","Xiang Xu","Junwei Cao","Hao Wang","Xuechun Sun","Junshuai Li","Yaqing Ma","Huaze Zhu","Wenbin Li","Wei Kong"],"affiliations":["Westlake University","Zhejiang University"],"journal":"Nature Electronics","shortJournal":"Nat Electron","volume":"9","pages":"1007-1017","citationCount":3,"citationSource":"crossref","year":"2026/09/01","abstract":"Atomic-scale ferroelectric films could be used to build high-density, low-power devices. However, ferroelectric materials typically suffer from stability and voltage-scaling challenges at extreme thinness. Here we report ferroelectricity in single-crystalline two-dimensional gallium oxide (Ga2O3), a wide-bandgap semiconductor. The material is just 6 Å thick and offers both high retention and thermal stability. We show that epitaxial β-Ga2O3 can be exfoliated down to a half-unit-cell thickness via a self-limiting exfoliation mechanism, which leads to a biaxial-strain-induced phase transition into a ferroelectric layered structure. Strain modulation reduces the polarization switching voltage to 0.8 V, meeting the voltage-scaling requirements of complementary metal–oxide–semiconductor technology. Theoretical calculations show that switching is driven by covalent bond reconstruction, effectively countering depolarization and enhancing stability. We also integrate ferroelectric two-dimensional Ga2O3 onto silicon using a low-temperature, back-end-of-line-compatible process. When β-Ga2O3 is thinned to the half-unit-cell limit, it can undergo a strain-induced phase transition that leads to intrinsic ferroelectricity with a polarization switching voltage of 0.8 V, meeting the voltage-scaling requirements of complementary metal–oxide–semiconductor technology.","source":"crossref + openalex + page-meta","sources":["crossref","openalex","page-meta"],"input":"10.1038/s41928-026-01694-1"}},
  {"query":"10.1038/s41578-026-00949-9","body":{"doi":"10.1038/s41578-026-00949-9","title":"Engineered interfaces in electronic materials for energy-efficient computing","authors":["Sathvik Ajay Iyengar","Pulickel M. Ajayan","Vincent Meunier","Tahir Ghani","Sayeef Salahuddin","Asir Intisar Khan"],"affiliations":["Lawrence Berkeley National Laboratory","Rice University","University of California, Berkeley","Pennsylvania State University","Intel (United States)"],"journal":"Nature Reviews Materials","shortJournal":"Nat Rev Mater","volume":"11","pages":"734-748","citationCount":1,"citationSource":"crossref","year":"2026/08/03","abstract":"The rapid expansion of data-centric technologies has made energy-efficient computing a technological and societal priority. Modern systems consume energy not only through computation but also through data movement between logic and memory, resistive losses in interconnects and heat removal. These energy costs intensify as devices shrink and integration density increases. Architectural strategies such as three-dimensional integration reduce latency and increase functional density by bringing memory and logic closer together. Yet further scaling is progressively constrained by materials functionality at interfaces, rather than by bulk properties. In this Perspective, we argue that transport within the first few atomic layers at material boundaries will determine the efficiency and scalability of future electronic devices. First, we outline four governing principles of interface engineering: electrostatics, electronic&nbsp;hybridization, boundary-dominated transport and thermal and structural stability. We then derive design rules and use representative device examples to show how engineered interfaces control switching energy, electrical conduction, heat dissipation and reliability. Finally, we consider the need for low-temperature materials synthesis, interface-sensitive metrology and uncertainty-aware predictive modelling to facilitate future advances in energy-efficient computing. As electronic devices downscale, the energy efficiency of computing is increasingly limited by interfacial transport processes. This Perspective outlines how engineered electronic-material interfaces control switching, charge and heat transport, and reliability and discusses interface design for logic, memory, interconnects and thermal management, whereas identifying predictive modelling needs for interface design.","source":"crossref + openalex + page-meta","sources":["crossref","openalex","page-meta"],"input":"10.1038/s41578-026-00949-9"}},
  {"query":"10.1063/5.0141987","body":{"doi":"10.1063/5.0141987","title":"Semiconducting nonperovskite ferroelectric oxynitride designed <i>ab initio</i>","authors":["Qisheng Yu","Jiawei Huang","Changming Ke","Zhuang Qian","Liyang Ma","Shi Liu"],"affiliations":["Key Laboratory for Quantum Materials of Zhejiang Province, Department of Physics, School of Science and Research Center for Industries of the Future, Westlake University 1 , Hangzhou, Zhejiang 310030, China","Institute of Natural Sciences, Westlake Institute for Advanced Study 2 , Hangzhou, Zhejiang 310024, China","Westlake University"],"journal":"Applied Physics Letters","shortJournal":"","volume":"122","pages":"142902","citationCount":2,"citationSource":"crossref","year":"2023/04/03","abstract":"The recent discovery of HfO2-based and nitride-based ferroelectrics that are compatible to the semiconductor manufacturing process has revitalized the field of ferroelectric-based nanoelectronics. Guided by a simple design principle of charge compensation and density functional theory calculations, we discover that HfO2-like mixed-anion materials, TaON and NbON, can crystallize in the polar Pca 2 1 phase with a strong thermodynamic driving force to adopt anion ordering spontaneously. Both oxynitrides possess large remnant polarization, low switching barriers, and unconventional negative piezoelectric effect, making them promising piezoelectrics and ferroelectrics. Distinct from HfO2 that has a wide bandgap, both TaON and NbON can absorb visible light and have high charge carrier mobilities, suitable for ferroelectric photovoltaic and photocatalytic applications. This class of multifunctional nonperovskite oxynitride containing economical and environmentally benign elements offers a platform to design and optimize high-performing ferroelectric semiconductors for integrated systems.","source":"crossref + openalex","sources":["crossref","openalex"],"input":"10.1063/5.0141987"}},
  {"query":"10.1021/acs.nanolett.5c05947","body":{"doi":"10.1021/acs.nanolett.5c05947","title":"Enabling Radiation Hardness in Solid-State NAND Storage Utilizing a Laminated Ferroelectric Stack","authors":["Lance Fernandes","Stuart Wodzro","Prasanna Venkatesan","Priyankka Ravikumar","Ming-Yen Lee","Minji Shon","Dyutimoy Chakraborty","Taeyoung Song","Sanghyun Kang","Salma Soliman","Mengkun Tian","Jason Yeager","Jackson Adler","Jiayi Chen","Zekai Wang","Douglas Wolfe","Shimeng Yu","Andrea Padovani","Suman Datta","Biswajit Ray","Asif Khan"],"affiliations":["School of Electrical and Computer Engineering","Georgia Institute of Technology","Institute of Matter and Systems","Department of Material Science and Engineering","Pennsylvania State University","Department of Engineering Sciences and Methods","University of Modena and Reggio Emilia","Department of Electrical and Computer Engineering","Colorado State University"],"journal":"Nano Letters","shortJournal":"Nano Lett.","volume":"26","pages":"3390-3397","citationCount":2,"citationSource":"crossref","year":"2026/03/05","abstract":"High Resolution Image Download MS PowerPoint Slide NAND flash forms the core of modern solid-state storage, which is critical for data-intensive AI applications, yet charge-trap NAND suffers rapid threshold-voltage ( V th ) degradation under ionizing radiation, causing reliability challenges for space and defense applications. Here we show that ferroelectric field-effect transistors (FeFETs) with laminated gate stacks offer a promising route to achieving radiation resilience in vertical NAND technology. We demonstrate that large-memory-window, vertical NAND-compatible laminated poly-silicon-channel FeFETs with an 8 nm Hf 0.5 Zr 0.5 O 2 /3 nm Al 2 O 3 /8 nm Hf 0.5 Zr 0.5 O 2 stack retain a full memory window and robust switching up to 10 Mrad(air) of the total ionizing dose (TID). Programmed and erased states show negligible TID-induced drift after 1 Mrad(air), while only the erased state degrades by ∼2 V at 10 Mrad(air). Technology computer-aided design (TCAD) modeling attributes these asymmetric shifts to state-dependent traps. Compared to charge-trap NAND, laminated FeFETs exhibit ∼30-fold lower V th degradation per unit dose, positioning them as superior radiation-resilient storage candidates.","source":"crossref + openalex","sources":["crossref","openalex"],"input":"10.1021/acs.nanolett.5c05947"}},
  {"query":"10.1126/science.aeh3697","body":{"doi":"10.1126/science.aeh3697","title":"Giant tunneling electroresistance in sliding ferroelectrics","authors":["Yue Wang","Yu Zhao","Yifei Zhang","Liutianyi Zhang","Zijian Zhong","Sishuo Liu","Chentao Hou","Fanxin Liu","Bin-Bin Zhang","Zhongming Wei","Yue-Yang Liu","Han Wang","Ping-Heng Tan","Jiangbin Wu"],"affiliations":["State Key Laboratory of Semiconductor Physics and Chip Technologies, Institute of Semiconductors, Chinese Academy of Sciences, Beijing, China.","Center of Materials Science and Optoelectronics Engineering, University of Chinese Academy of Sciences, Beijing, China.","Department of Electrical and Electronic Engineering, University of Hong Kong, Hong Kong SAR, China.","School of Physics, Zhejiang University of Technology, Hangzhou, China.","College of Advanced Interdisciplinary Studies and Nanhu Laser Laboratory, National University of Defense Technology, Changsha, China.","Zhangjiang Laboratory, Pudong, Shanghai, China.","Chinese Academy of Sciences","Institute of Semiconductors","University of Chinese Academy of Sciences","University of Hong Kong","Zhejiang University of Technology","National University of Defense Technology","Shanghai Zhangjiang Laboratory","Zhangjiang Laboratory"],"journal":"Science","shortJournal":"Science","volume":"393","pages":"1139-1144","citationCount":0,"citationSource":"crossref","year":"2026/09/10","abstract":"Nonvolatile memories should store information reliably while consuming little energy. Ferroelectric tunnel junctions offer compact readout, but conventional ionic displacement ferroelectrics can fatigue, and two-dimensional sliding ferroelectrics are robust but generate weak readout in two terminal devices. We engineered a van der Waals junction using rhombohedral molybdenum disulfide, hexagonal boron nitride, monolayer graphene, and chromium. This architecture converts small sliding polarization into synergistic modulation of tunneling barrier height and carrier concentration. The devices showed tunneling electroresistance above 10 million, a high conductance state current density of 222 amperes per square centimeter at 0.5 volts, and an endurance beyond 100 billion cycles while switching with 13-nanosecond pulses at an estimated energy of 6.5 femtojoules, offering a route to compact low-power memory.","source":"crossref + openalex","sources":["crossref","openalex"],"input":"10.1126/science.aeh3697"}},
  {"query":"10.1038/s41563-026-02533-6","body":{"doi":"10.1038/s41563-026-02533-6","title":"Grain boundary stabilization of fluorite ferroelectrics","authors":["Shiyu Wang","Hai Zhong","Siyi Song","Ang Gao","Qinghua Zhang","Dong Su","Kuijuan Jin","Chen Ge","Lin Gu"],"affiliations":["Chinese Academy of Sciences","Institute of Physics","University of Chinese Academy of Sciences","Ludong University","Central China Normal University","Tsinghua University"],"journal":"Nature Materials","shortJournal":"Nat. Mater.","volume":"25","pages":"1378-1384","citationCount":6,"citationSource":"crossref","year":"2026/03/13","abstract":"Grain boundaries (GBs) can tailor the macroscopic properties of polycrystalline materials via their intrinsic structural and electronic states. However, as independent heterointerfaces, their role in stabilizing grain phases remains largely unexplored, especially at the atomic scale. Here we report that chemically ordered heterogeneous GBs in ZrO2 thin films act as active stabilizers of a metastable polar phase. The atomically sharp and ordered La(Sr)–Mn–O configurations at GBs are identified at the atomic scale. The resultant charge ordering and bond covalency of the GBs are validated by four-dimensional scanning transmission electron microscopy. This structural motif induces eg/t2g orbital ordering of Mn ions at GBs, modulating Zr–O bond strength to stabilize the polar phase. This work establishes a GB-centric paradigm for engineering nanoscale phase diagrams, offering a promising strategy for designing metastable functional materials via GB chemistry. Electron microscopy and spectroscopy, together with electronic structure calculations, are used to show that orbital ordering of ions at grain boundaries can facilitate the stabilization of ferroelectric phases.","source":"crossref + openalex + page-meta","sources":["crossref","openalex","page-meta"],"input":"10.1038/s41563-026-02533-6"}},
  {"query":"https://doi.org/10.1038/s41928-026-01694-1","body":{"doi":"10.1038/s41928-026-01694-1","title":"Ferroelectricity in six-ångström-thick two-dimensional gallium oxide","authors":["Tong Jiang","Han Chen","Yubo Yuan","Xiang Xu","Junwei Cao","Hao Wang","Xuechun Sun","Junshuai Li","Yaqing Ma","Huaze Zhu","Wenbin Li","Wei Kong"],"affiliations":["Westlake University","Zhejiang University"],"journal":"Nature Electronics","shortJournal":"Nat Electron","volume":"9","pages":"1007-1017","citationCount":3,"citationSource":"crossref","year":"2026/09/01","abstract":"Atomic-scale ferroelectric films could be used to build high-density, low-power devices. However, ferroelectric materials typically suffer from stability and voltage-scaling challenges at extreme thinness. Here we report ferroelectricity in single-crystalline two-dimensional gallium oxide (Ga2O3), a wide-bandgap semiconductor. The material is just 6 Å thick and offers both high retention and thermal stability. We show that epitaxial β-Ga2O3 can be exfoliated down to a half-unit-cell thickness via a self-limiting exfoliation mechanism, which leads to a biaxial-strain-induced phase transition into a ferroelectric layered structure. Strain modulation reduces the polarization switching voltage to 0.8 V, meeting the voltage-scaling requirements of complementary metal–oxide–semiconductor technology. Theoretical calculations show that switching is driven by covalent bond reconstruction, effectively countering depolarization and enhancing stability. We also integrate ferroelectric two-dimensional Ga2O3 onto silicon using a low-temperature, back-end-of-line-compatible process. When β-Ga2O3 is thinned to the half-unit-cell limit, it can undergo a strain-induced phase transition that leads to intrinsic ferroelectricity with a polarization switching voltage of 0.8 V, meeting the voltage-scaling requirements of complementary metal–oxide–semiconductor technology.","source":"crossref + openalex + page-meta","sources":["crossref","openalex","page-meta"],"input":"https://doi.org/10.1038/s41928-026-01694-1"}},
  {"query":"10.48550/arXiv.2605.18407","body":{"doi":"10.48550/arXiv.2605.18407","title":"Qumus: Realization of An Embodied AI Quantum Material Experimentalist","authors":["Lihan Shi","Zhaoyi Joy Zheng","Xinzhe Juan","Yimin Wang","Ming Yin","Mayank Sengupta","Kristina Wolinski","Yanyu Jia","Jingzhi Shi","Derek Saucedo","Neill Saggi","Haosen Guan","Kenji Watanabe","Takashi Taniguchi","Ali Yazdani","Mengdi Wang","Sanfeng Wu"],"affiliations":["Princeton University","University of Michigan","California State University, Northridge","National Institute for Materials Science","Research Center for Materials Nanoarchitectonics"],"journal":"arXiv","shortJournal":"","volume":"","pages":"","citationCount":10,"citationSource":"openalex","year":"2026/05/18","abstract":"While modern Large Language Models (LLMs) and agentic artificial intelligence (AI) have demonstrated transformative capabilities in digital domains, the realization of embodied AI capable of real-world scientific discovery remains a difficult frontier. The advancements are hindered by the inherent complexity of integrating high-level reasoning, multimodal information processing and real-time physical execution. Here we introduce Qumus, the first AI quantum materials experimentalist. Physically embodied within a robotic mini-laboratory, Qumus is an intelligent, multimodal, and multi-agent system designed for the creation and nano-processing of atomically thin two-dimensional (2D) materials and stacked van der Waals (vdW) structures. Qumus autonomously navigates the full scientific cycle, from hypothesis generation and protocol planning to multi-step experimental execution, result analysis and reporting, acting as an experimentalist. Markedly, the system has achieved, for the first time, the AI-creation of graphene, as well as the first AI-fabrication of complex nanodevices including atomically thin field-effect transistors via vdW stacking. Qumus excels at these tasks by demonstrating autonomous error correction and closed-loop experimentation. Our results establish a generalizable framework for self-improving embodied AI systems that learn directly from the quantum world, opening a pathway toward accelerated discovery in quantum materials, electronics and beyond.","source":"datacite + openalex","sources":["datacite","openalex"],"input":"10.48550/arXiv.2605.18407"}},
  {"query":"10.48550/arXiv.2604.15131","body":{"doi":"10.48550/arXiv.2604.15131","title":"Fully Atomic-Layer-Deposited Vertical Complementary FeRAM with Ultra-High 2Pr &gt; 100 uC/cm2 and High Endurance &gt; 1E10 cycles","authors":["Renhao Xue","Ruizhan Yan","Mansun Chan","Xiwen Liu"],"affiliations":["The Hong Kong University of Science and Technology (Guangzhou)","Hong Kong University of Science and Technology"],"journal":"arXiv","shortJournal":"","volume":"","pages":"","citationCount":0,"citationSource":"openalex","year":"2026/04/16","abstract":"A limited remanent polarization (Pr) in HfO2-based FeRAM remains a key obstacle to density scaling and reliability, while material and process optimizations offer only incremental improvements. This limitation fundamentally originates from the thickness-constrained switchable polarization and the intrinsic polarization ceiling of HfO2-based ferroelectrics. Here, we propose an all-ALD-grown vertical complementary FeRAM (VCF) architecture, in which the top and bottom stacked FeRAM cells maintain complementary polarization. This complementary dipole configuration converts the readout from a single-layer polarization response into a differential polarization summation, thereby amplifying the effective charge window without increasing the switching field of each individual layer or incurring area overhead. Viewed from top to bottom, an \"up-down\" polarization pair stores logic '1', whereas a \"down-up\" pair stores logic '0'. Using a complementary polarization write-read scheme, the VCF achieves an effective differential polarization above 100 uC/cm^2 and retains above 90 uC/cm^2 after 1e10 switching cycles without electrical breakdown. Robust retention (longer than 1e4 s at 85 degC) and strong disturb immunity are demonstrated, with an effective differential polarization above 80 uC/cm^2 under a V/3 scheme after 1e6 disturb pulses. Array-level operation is validated in a 5 x 5 selector-free crosspoint array. The performance enhancement of the VCF arises from the co-optimization of the all-ALD-grown process, device architecture, and operation scheme, enabling high density, a wide memory window, and strong reliability for scalable FeRAM integration.","source":"datacite + openalex","sources":["datacite","openalex"],"input":"10.48550/arXiv.2604.15131"}},
  {"query":"https://arxiv.org/abs/2605.18407","body":{"doi":"10.48550/arxiv.2605.18407","title":"Qumus: Realization of An Embodied AI Quantum Material Experimentalist","authors":[],"affiliations":["Princeton University","University of Michigan","California State University, Northridge","National Institute for Materials Science","Research Center for Materials Nanoarchitectonics"],"journal":"arXiv (Cornell University)","shortJournal":"","volume":"","pages":"","citationCount":10,"citationSource":"openalex","year":"2026/05/18","abstract":"While modern Large Language Models (LLMs) and agentic artificial intelligence (AI) have demonstrated transformative capabilities in digital domains, the realization of embodied AI capable of real-world scientific discovery remains a difficult frontier. The advancements are hindered by the inherent complexity of integrating high-level reasoning, multimodal information processing and real-time physical execution. Here we introduce Qumus, the first AI quantum materials experimentalist. Physically embodied within a robotic mini-laboratory, Qumus is an intelligent, multimodal, and multi-agent system designed for the creation and nano-processing of atomically thin two-dimensional (2D) materials and stacked van der Waals (vdW) structures. Qumus autonomously navigates the full scientific cycle, from hypothesis generation and protocol planning to multi-step experimental execution, result analysis and reporting, acting as an experimentalist. Markedly, the system has achieved, for the first time, the AI-creation of graphene, as well as the first AI-fabrication of complex nanodevices including atomically thin field-effect transistors via vdW stacking. Qumus excels at these tasks by demonstrating autonomous error correction and closed-loop experimentation. Our results establish a generalizable framework for self-improving embodied AI systems that learn directly from the quantum world, opening a pathway toward accelerated discovery in quantum materials, electronics and beyond.","source":"openalex","sources":["openalex"],"input":"https://arxiv.org/abs/2605.18407"}},
  {"query":"https://arxiv.org/abs/2604.15131","body":{"doi":"10.48550/arxiv.2604.15131","title":"Fully Atomic-Layer-Deposited Vertical Complementary FeRAM with Ultra-High 2Pr > 100 uC/cm2 and High Endurance > 1E10 cycles","authors":[],"affiliations":["The Hong Kong University of Science and Technology (Guangzhou)","Hong Kong University of Science and Technology"],"journal":"arXiv (Cornell University)","shortJournal":"","volume":"","pages":"","citationCount":0,"citationSource":"openalex","year":"2026/04/16","abstract":"A limited remanent polarization (Pr) in HfO2-based FeRAM remains a key obstacle to density scaling and reliability, while material and process optimizations offer only incremental improvements. This limitation fundamentally originates from the thickness-constrained switchable polarization and the intrinsic polarization ceiling of HfO2-based ferroelectrics. Here, we propose an all-ALD-grown vertical complementary FeRAM (VCF) architecture, in which the top and bottom stacked FeRAM cells maintain complementary polarization. This complementary dipole configuration converts the readout from a single-layer polarization response into a differential polarization summation, thereby amplifying the effective charge window without increasing the switching field of each individual layer or incurring area overhead. Viewed from top to bottom, an \"up-down\" polarization pair stores logic '1', whereas a \"down-up\" pair stores logic '0'. Using a complementary polarization write-read scheme, the VCF achieves an effective differential polarization above 100 uC/cm^2 and retains above 90 uC/cm^2 after 1e10 switching cycles without electrical breakdown. Robust retention (longer than 1e4 s at 85 degC) and strong disturb immunity are demonstrated, with an effective differential polarization above 80 uC/cm^2 under a V/3 scheme after 1e6 disturb pulses. Array-level operation is validated in a 5 x 5 selector-free crosspoint array. The performance enhancement of the VCF arises from the co-optimization of the all-ALD-grown process, device architecture, and operation scheme, enabling high density, a wide memory window, and strong reliability for scalable FeRAM integration.","source":"openalex","sources":["openalex"],"input":"https://arxiv.org/abs/2604.15131"}},
  {"query":"https://www.nature.com/articles/s41928-026-01694-1","body":{"doi":"10.1038/s41928-026-01694-1","title":"Ferroelectricity in six-ångström-thick two-dimensional gallium oxide","authors":["Tong Jiang","Han Chen","Yubo Yuan","Xiang Xu","Junwei Cao","Hao Wang","Xuechun Sun","Junshuai Li","Yaqing Ma","Huaze Zhu","Wenbin Li","Wei Kong"],"affiliations":["Westlake University","Zhejiang University"],"journal":"Nature Electronics","shortJournal":"Nat Electron","volume":"9","pages":"1007","citationCount":3,"citationSource":"crossref","year":"2026/09/01","abstract":"Atomic-scale ferroelectric films could be used to build high-density, low-power devices. However, ferroelectric materials typically suffer from stability and voltage-scaling challenges at extreme thinness. Here we report ferroelectricity in single-crystalline two-dimensional gallium oxide (Ga2O3), a wide-bandgap semiconductor. The material is just 6 Å thick and offers both high retention and thermal stability. We show that epitaxial β-Ga2O3 can be exfoliated down to a half-unit-cell thickness via a self-limiting exfoliation mechanism, which leads to a biaxial-strain-induced phase transition into a ferroelectric layered structure. Strain modulation reduces the polarization switching voltage to 0.8 V, meeting the voltage-scaling requirements of complementary metal–oxide–semiconductor technology. Theoretical calculations show that switching is driven by covalent bond reconstruction, effectively countering depolarization and enhancing stability. We also integrate ferroelectric two-dimensional Ga2O3 onto silicon using a low-temperature, back-end-of-line-compatible process. When β-Ga2O3 is thinned to the half-unit-cell limit, it can undergo a strain-induced phase transition that leads to intrinsic ferroelectricity with a polarization switching voltage of 0.8 V, meeting the voltage-scaling requirements of complementary metal–oxide–semiconductor technology.","source":"page-meta + crossref + openalex","sources":["page-meta","crossref","openalex"],"input":"https://www.nature.com/articles/s41928-026-01694-1"}},
  {"query":"https://www.nature.com/articles/s41578-026-00949-9","body":{"doi":"10.1038/s41578-026-00949-9","title":"Engineered interfaces in electronic materials for energy-efficient computing","authors":["Sathvik Ajay Iyengar","Pulickel M. Ajayan","Vincent Meunier","Tahir Ghani","Sayeef Salahuddin","Asir Intisar Khan"],"affiliations":["Lawrence Berkeley National Laboratory","Rice University","University of California, Berkeley","Pennsylvania State University","Intel (United States)"],"journal":"Nature Reviews Materials","shortJournal":"Nat Rev Mater","volume":"11","pages":"734","citationCount":1,"citationSource":"crossref","year":"2026/08/03","abstract":"The rapid expansion of data-centric technologies has made energy-efficient computing a technological and societal priority. Modern systems consume energy not only through computation but also through data movement between logic and memory, resistive losses in interconnects and heat removal. These energy costs intensify as devices shrink and integration density increases. Architectural strategies such as three-dimensional integration reduce latency and increase functional density by bringing memory and logic closer together. Yet further scaling is progressively constrained by materials functionality at interfaces, rather than by bulk properties. In this Perspective, we argue that transport within the first few atomic layers at material boundaries will determine the efficiency and scalability of future electronic devices. First, we outline four governing principles of interface engineering: electrostatics, electronic&nbsp;hybridization, boundary-dominated transport and thermal and structural stability. We then derive design rules and use representative device examples to show how engineered interfaces control switching energy, electrical conduction, heat dissipation and reliability. Finally, we consider the need for low-temperature materials synthesis, interface-sensitive metrology and uncertainty-aware predictive modelling to facilitate future advances in energy-efficient computing. As electronic devices downscale, the energy efficiency of computing is increasingly limited by interfacial transport processes. This Perspective outlines how engineered electronic-material interfaces control switching, charge and heat transport, and reliability and discusses interface design for logic, memory, interconnects and thermal management, whereas identifying predictive modelling needs for interface design.","source":"page-meta + crossref + openalex","sources":["page-meta","crossref","openalex"],"input":"https://www.nature.com/articles/s41578-026-00949-9"}},
  {"query":"https://pubs.aip.org/aip/apl/article/128/14/142902/3386286","body":{"doi":"10.1063/1.4801497","title":"Impact of carbon and nitrogen impurities in high-κ dielectrics on metal-oxide-semiconductor devices","authors":["Minseok Choi","John L. Lyons","Anderson Janotti","Chris G. Van de Walle"],"affiliations":["Materials Department, University of California , Santa Barbara, California 93106, USA"],"journal":"Applied Physics Letters","shortJournal":"","volume":"102","pages":"142902","citationCount":114,"citationSource":"crossref","year":"2013/04/08","abstract":"We investigate the electronic structure of carbon and nitrogen impurities, which are commonly incorporated during atomic-layer deposition of high-κ oxides such as Al2O3 and HfO2. The impact on metal-oxide-semiconductor devices is assessed by examining formation energies, transition levels, and band alignment between the oxide and semiconductors such as GaN, Si, and III-As. Carbon introduces charge-state transition levels near the semiconductor conduction-band edges, resulting in border traps and/or leakage current. Nitrogen acts as a source of negative fixed charge but may also be effective in alleviating the problem of carrier traps associated with native defects.","source":"crossref-article-number","sources":["crossref-article-number"],"input":"https://pubs.aip.org/aip/apl/article/128/14/142902/3386286"}},
  {"query":"Ferroelectricity in six-ångström-thick two-dimensional gallium oxide","body":{"doi":"10.1038/s41928-026-01694-1","title":"Ferroelectricity in six-ångström-thick two-dimensional gallium oxide","authors":["Tong Jiang","Han Chen","Yubo Yuan","Xiang Xu","Junwei Cao","Hao Wang","Xuechun Sun","Junshuai Li","Yaqing Ma","Huaze Zhu","Wenbin Li","Wei Kong"],"affiliations":["Westlake University","Zhejiang University"],"journal":"Nature Electronics","shortJournal":"","volume":"9","pages":"1007","citationCount":3,"citationSource":"openalex","year":"2026/09/01","abstract":"","source":"openalex","sources":["openalex"],"input":"Ferroelectricity in six-ångström-thick two-dimensional gallium oxide"}},
];

const proxyUrl = (q) => `https://researchatlas.io/api/metadata?query=${encodeURIComponent(q)}`;
const golden = (q) => structuredClone(GOLDENS.find((g) => g.query === q).body);

// Allowed differences (everything else must be identical):
// 1. doi.org → publisher-page abstract fallback ("page-meta" source): the browser cannot read
//    publisher HTML (doi.org redirects to www.nature.com, which sends no CORS headers and is
//    outside connect-src). Crossref/OpenAlex had no abstract for these Nature papers, so it stays empty.
const withoutPageMeta = (b) => {
  const sources = b.sources.filter((s) => s !== "page-meta");
  return { ...b, abstract: "", sources, source: sources.join(" + ") };
};
// 2. arxiv.org URLs: the original used the arXiv API + OpenAlex (authors stripped). Production's
//    arXiv API calls were failing, so the golden is OpenAlex-only with authors: []. The browser
//    can't reach export.arxiv.org either and uses DataCite in its place, so the answer equals the
//    DOI-form lookup (10.48550/arXiv.<id>): authors restored, journal "arXiv", DataCite title/doi.
const asArxivDoiLookup = (doiQuery) => (b) => ({ ...golden(doiQuery), input: b.input });
// citationCount drift: none observed between the 2026-11-10 goldens and the 2026-11-11 recording.
const ALLOWED = {
  "10.1038/s41928-026-01694-1": withoutPageMeta,
  "10.1038/s41578-026-00949-9": withoutPageMeta,
  "10.1038/s41563-026-02533-6": withoutPageMeta,
  "https://doi.org/10.1038/s41928-026-01694-1": withoutPageMeta,
  "https://arxiv.org/abs/2605.18407": asArxivDoiLookup("10.48550/arXiv.2605.18407"),
  "https://arxiv.org/abs/2604.15131": asArxivDoiLookup("10.48550/arXiv.2604.15131"),
};

for (const { query } of GOLDENS) {
  test(`golden: lookupMetadata(${JSON.stringify(query)})`, async () => {
    const fetch = fixtureFetch();
    const got = await lookupMetadata(query, { fetch });
    const adjust = ALLOWED[query] || ((b) => b);
    assert.deepEqual(got, adjust(golden(query)));
    assert.ok(!fetch.calls.some((c) => c.url.includes("arxiv.org/api")), "no arXiv API calls");
  });
}

test("goldens: allowed differences really are differences (keeps the allow-list honest)", () => {
  for (const [q, adjust] of Object.entries(ALLOWED)) assert.notDeepEqual(adjust(golden(q)), golden(q), q);
});

test("goldens 11–13 (publisher URLs) go through the researchatlas.io proxy", async () => {
  for (const q of ["https://www.nature.com/articles/s41928-026-01694-1", "https://pubs.aip.org/aip/apl/article/128/14/142902/3386286"]) {
    const fetch = fixtureFetch();
    await lookupMetadata(q, { fetch });
    assert.deepEqual(fetch.calls.map((c) => c.url), [proxyUrl(q)]);
  }
});

test("proxy down: the original's page-failed path runs locally (Crossref article-number)", async () => {
  const q = "https://pubs.aip.org/aip/apl/article/128/14/142902/3386286";
  const fetch = fixtureFetch({ failing: [proxyUrl(q)] });
  assert.deepEqual(await lookupMetadata(q, { fetch }), golden(q));
  assert.ok(fetch.calls.some((c) => c.url === "https://api.crossref.org/works?filter=member:317,article-number:142902&rows=1"));
});

test("proxy down and nothing local: minimal result flagged incomplete", async () => {
  const q = "https://www.nature.com/articles/s41928-026-01694-1";
  const got = await lookupMetadata(q, { fetch: fixtureFetch({ failing: [proxyUrl(q)] }) });
  assert.equal(got.incomplete, true);
  assert.equal(got.url, q);
  assert.equal(got.input, q);
  assert.equal(got.title, "");
  assert.deepEqual(got.authors, []);
  assert.deepEqual(got.errors, ["page-meta: Failed to fetch"]);
});

test("proxy answers 502: its detail is kept, result flagged incomplete", async () => {
  const got = await lookupMetadata("https://example.org/blog/some-random-post", { fetch: fixtureFetch() });
  assert.equal(got.incomplete, true);
  assert.deepEqual(got.errors, ["page-meta: No metadata found."]);
});

test("unknown DOI throws the route's 502 detail", async () => {
  await assert.rejects(lookupMetadata("10.9999/no-such-doi-ra-test", { fetch: fixtureFetch() }), (err) => {
    assert.equal(err.message, "crossref: HTTP Error 404: Not Found");
    assert.equal(err.status, 502);
    return true;
  });
});

test("empty query is a 422", async () => {
  await assert.rejects(lookupMetadata("   ", { fetch: fixtureFetch() }), (err) => err.status === 422);
});

test("total network failure throws with every source's error", async () => {
  const fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(lookupMetadata("10.1063/5.0141987", { fetch: Object.assign(fetch, {}) }),
    { message: "crossref: Failed to fetch; openalex: Failed to fetch" });
});

// ---- helpers ----

test("pyQuote / pyUnquote match urllib.parse", () => {
  assert.equal(pyQuote("10.1000/a(b);c:d"), "10.1000/a%28b%29%3Bc%3Ad");
  assert.equal(pyQuote("10.1000/a(b):d", ":/"), "10.1000/a%28b%29:d");
  assert.equal(pyQuote("six-ångström x", ""), "six-%C3%A5ngstr%C3%B6m%20x");
  assert.equal(pyUnquote("10.1000%2Fabc%28x%29"), "10.1000/abc(x)");
  assert.equal(pyUnquote("100% sure %zz"), "100% sure %zz");
  assert.equal(pyUnquote("%C3%A5"), "å");
});

test("extractDoi: URLs, text, prefixes", () => {
  assert.equal(extractDoi("https://doi.org/10.1038/s41928-026-01694-1"), "10.1038/s41928-026-01694-1");
  assert.equal(extractDoi("https://pubs.acs.org/doi/10.1021/acs.nanolett.5c05947?ref=pdf"), "10.1021/acs.nanolett.5c05947");
  assert.equal(extractDoi("https://example.com/redirect?u=https%3A%2F%2Fdoi.org%2F10.1063%2F5.0141987"), "10.1063/5.0141987");
  assert.equal(extractDoi("see 10.1063/5.0141987 for details"), "10.1063/5.0141987");
  assert.equal(extractDoi("10.1063/5.0141987."), "10.1063/5.0141987.", "trailing dot kept, like the original");
  assert.equal(extractDoi("DOI:10.123/xyz"), "10.123/xyz", "doi: prefix fallback when the pattern fails");
  assert.equal(extractDoi("10.12/odd"), "10.12/odd", "10. prefix fallback");
  assert.equal(extractDoi("https://www.nature.com/articles/s41928-026-01694-1"), "");
  assert.equal(extractDoi(""), "");
});

test("extractArxivId / isArxivDoi", () => {
  assert.equal(extractArxivId("https://arxiv.org/abs/2605.18407"), "2605.18407");
  assert.equal(extractArxivId("https://arxiv.org/pdf/2605.18407v2.pdf"), "2605.18407v2");
  assert.equal(extractArxivId("https://ARXIV.org/abs/2605.18407?context=cs"), "2605.18407");
  assert.equal(extractArxivId("10.48550/arXiv.2605.18407"), "2605.18407");
  // The original raised IndexError here (case-sensitive split on "arXiv.").
  assert.equal(extractArxivId("10.48550/arxiv.2605.18407"), "2605.18407");
  assert.equal(extractArxivId("10.1063/5.0141987"), "");
  assert.equal(isArxivDoi("10.48550/ARXIV.1"), true);
  assert.equal(isArxivDoi("10.1063/5.0141987"), false);
});

test("date normalization", () => {
  assert.equal(normalizePartialDateParts([2026, 9, 1]), "2026/09/01");
  assert.equal(normalizePartialDateParts([2026, 9]), "2026/09");
  assert.equal(normalizePartialDateParts(["2026"]), "2026");
  assert.equal(normalizePartialDateParts([]), "");
  assert.equal(normalizePartialDateParts(null), "");
  assert.equal(normalizePartialDateParts([null]), "", "original gave 'None'");
  assert.equal(normalizeIsoDateText("2026-05-18T17:59:59Z"), "2026/05/18");
  assert.equal(normalizeIsoDateText("2026-5"), "2026/05");
  assert.equal(normalizeIsoDateText("Published May 2026"), "2026");
  assert.equal(normalizeIsoDateText("1899-01-01"), "");
  assert.equal(normalizeIsoDateText(null), "");
  assert.equal(chooseMorePrecisePublicationDate("2026", "2026/05"), "2026/05");
  assert.equal(chooseMorePrecisePublicationDate("2026/05/01", "2026/06"), "2026/05/01");
  assert.equal(chooseMorePrecisePublicationDate("", "2026"), "2026");
  assert.equal(chooseMorePrecisePublicationDate("2026-05", ""), "2026-05");
});

test("normalizeAbstract: JATS, MathML, Abstract label, no live markup", () => {
  assert.equal(normalizeAbstract('<jats:title>Abstract</jats:title><jats:p>We study <jats:italic>x</jats:italic>.</jats:p>'), "We study x.");
  assert.equal(normalizeAbstract('<jats:p>T<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:msub><mml:mi>T</mml:mi><mml:mi>c</mml:mi></mml:msub></mml:math> rises</jats:p>'), "TTc rises");
  assert.equal(normalizeAbstract("ABSTRACT: Foo"), "Foo");
  assert.equal(normalizeAbstract("Abstract. Foo"), "Foo");
  assert.equal(normalizeAbstract("Abstract — Foo"), "Foo");
  assert.equal(normalizeAbstract('<img src=x onerror="alert(1)">Hi<script>bad()</script>'), "Hibad()");
  assert.equal(normalizeAbstract("a &lt;b&gt; c"), "a &lt;b&gt; c", "entities are not decoded (as in the original)");
  assert.equal(normalizeAbstract(""), "");
  assert.equal(normalizeAbstract(null), "");
  assert.equal(openalexAbstract({ world: [1], Hello: [0], "2": [2] }), "Hello world 2");
});

test("journal + person-name normalization", () => {
  assert.equal(normalizeJournalName(" arxiv.org "), "arXiv");
  assert.equal(normalizeJournalName("Nature"), "Nature");
  assert.equal(normalizeJournalName(null), "");
  assert.equal(normalizePersonName("Shi,  Lihan"), "lihan shi");
  assert.equal(normalizePersonName("Jean-Luc Picard"), "jean luc picard");
  assert.equal(canonicalPersonName("Shi, Lihan"), "Lihan Shi");
  assert.equal(canonicalPersonName("Van de Walle, Chris G."), "Chris G. Van de Walle");
});

test("mergeMetadata: first-wins scalars, precise year, max citations, deduped people", () => {
  const a = { doi: "", title: "T", authors: ["Shi, Lihan"], affiliations: ["MIT"], year: "2026", citationCount: 3, source: "", sources: [] };
  const b = { doi: "10.1/x", title: "Other", authors: ["Lihan Shi", "Ann Lee"], affiliations: ["mit ", "Harvard"], year: "2026/05/01", citationCount: 1, source: "openalex" };
  const m = mergeMetadata(mergeMetadata(a, { source: "crossref" }), b);
  assert.equal(m.title, "T");
  assert.equal(m.doi, "10.1/x");
  assert.equal(m.year, "2026/05/01");
  assert.equal(m.citationCount, 3);
  assert.deepEqual(m.authors, ["Lihan Shi", "Ann Lee"]);
  assert.deepEqual(m.affiliations, ["MIT", "Harvard"]);
  assert.deepEqual(m.sources, ["crossref", "openalex"]);
  assert.equal(m.source, "crossref + openalex");
});

// ---- references ----

const NOW = () => new Date("2026-11-11T08:09:10.123Z");

test("utcTimestamp drops milliseconds and zone like utcnow().isoformat()", () => {
  assert.equal(utcTimestamp(NOW()), "2026-11-11T08:09:10");
});

test("references: Crossref first", async () => {
  const fetch = fixtureFetch();
  const out = await fetchReferences({ doi: "10.1063/5.0141987" }, { fetch, now: NOW });
  assert.equal(out.source, "crossref");
  assert.equal(out.rows.length, 67); // legacy export: 67 rows for this paper
  assert.deepEqual(out.rows[0], { doi: "10.1063/1.3634052", title: "Ferroelectricity in hafnium oxide thin films", year: "2011", authors: "", journal: "Appl. Phys. Lett.", source: "crossref", fetchedAt: "2026-11-11T08:09:10" });
  assert.deepEqual(fetch.calls.map((c) => c.url), ["https://api.crossref.org/works/10.1063/5.0141987"]);
});

test("references: OpenAlex fallback batches referenced works", async () => {
  const fetch = fixtureFetch();
  const out = await fetchReferences({ doi: "10.1002/adts.201900200" }, { fetch, now: NOW });
  assert.equal(out.source, "openalex");
  assert.equal(out.rows.length, 50);
  assert.equal(fetch.calls.filter((c) => c.url.includes("filter=openalex_id:")).length, 1);
  assert.deepEqual(out.rows[0], { doi: "10.1038/nnano.2015.90", title: "Metal-halide perovskites for photovoltaic and light-emitting devices", year: "2015", authors: "Samuel D. Stranks, Henry J. Snaith", journal: "Nature Nanotechnology", source: "openalex", fetchedAt: "2026-11-11T08:09:10" });
});

test("references: arXiv skips Crossref, falls through to Semantic Scholar", async () => {
  const fetch = fixtureFetch();
  const out = await fetchReferences({ doi: "10.48550/arXiv.2604.15081" }, { fetch, now: NOW });
  assert.equal(out.source, "semanticscholar");
  assert.ok(out.rows.length > 0);
  assert.ok(!fetch.calls.some((c) => c.url.includes("crossref")));
  assert.ok(fetch.calls.some((c) => c.url.startsWith("https://api.semanticscholar.org/graph/v1/paper/ARXIV%3A2604.15081/references")));
});

test("references: nothing found → rows [] with source none", async () => {
  const out = await fetchReferences({ doi: "10.2172/1496734" }, { fetch: fixtureFetch(), now: NOW });
  assert.deepEqual(out, { source: "none", rows: [], fetchedAt: "2026-11-11T08:09:10" });
  assert.deepEqual(await fetchReferences({ doi: " " }, { fetch: fixtureFetch(), now: NOW }), { source: "none", rows: [], fetchedAt: "2026-11-11T08:09:10" });
});

test("references: OpenAlex cap 80, batches of ≤50, input order kept", async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `W${1000 + i}`);
  const fetch = async (url) => {
    const ok = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
    if (url.startsWith("https://api.crossref.org/")) return ok({ message: { reference: [] } });
    if (url === "https://api.openalex.org/works/doi:10.1/x") return ok({ referenced_works: ids.map((id) => `https://openalex.org/${id}`) });
    const m = url.match(/filter=openalex_id:([^&]+)&per_page=50&select=[^&]+$/);
    assert.ok(m, url);
    const batch = m[1].split("|");
    assert.ok(batch.length <= 50);
    // shuffled response, one work missing
    const results = batch.filter((id) => id !== "W1003").reverse().map((id) => ({ id: `https://openalex.org/${id}`, doi: null, display_name: `T ${id}`, publication_year: 2020, authorships: [], primary_location: null }));
    return ok({ results });
  };
  const calls = [];
  const out = await fetchReferences({ doi: "10.1/X" }, { fetch: async (u, i) => { calls.push(u); return fetch(u, i); }, now: NOW });
  assert.equal(out.source, "openalex");
  assert.equal(calls.filter((u) => u.includes("openalex_id")).length, 2);
  assert.deepEqual(out.rows.map((r) => r.title), ids.slice(0, 80).filter((id) => id !== "W1003").map((id) => `T ${id}`));
});

test("toReferenceRows: dedupe on (doi, lower(title)), truncation", () => {
  const long = "é".repeat(1100);
  const rows = toReferenceRows([
    { doi: "10.1/A", title: "Same", year: "2020" },
    { doi: "10.1/a", title: "same " },
    { doi: "", title: "One" },
    { doi: "", title: "Two" },
    { doi: "10.1/b", title: long, year: "y".repeat(40), authors: "a".repeat(600), journal: "j".repeat(600) },
  ], "crossref", "2026-11-11T08:09:10");
  assert.deepEqual(rows.map((r) => r.doi), ["10.1/a", "", "", "10.1/b"]);
  assert.equal(rows[0].title, "Same");
  assert.equal(rows[3].title.length, 1024);
  assert.equal(rows[3].year.length, 32);
  assert.equal(rows[3].authors.length, 512);
  assert.equal(rows[3].journal.length, 512);
  assert.deepEqual(Object.keys(rows[0]), ["doi", "title", "year", "authors", "journal", "source", "fetchedAt"]);
});

test("enrichReference: Crossref, arXiv via OpenAlex, miss → {}", async () => {
  const fetch = fixtureFetch();
  assert.deepEqual(await enrichReference("10.1063/1.3634052", { fetch }), {
    title: "Ferroelectricity in hafnium oxide thin films", year: "2011/09/05",
    authors: "T. S. Böscke, J. Müller, D. Bräuhaus, U. Schröder, U. Böttger", journal: "Applied Physics Letters",
  });
  const arxiv = await enrichReference("10.48550/arXiv.2605.18407", { fetch });
  assert.equal(arxiv.title, "Qumus: Realization of An Embodied AI Quantum Material Experimentalist");
  assert.equal(arxiv.authors.split(", ").length, 12); // first 6 OpenAlex raw names, each "Last, First"
  assert.deepEqual(await enrichReference("10.9999/no-such-doi-ra-test", { fetch }), {});
  assert.deepEqual(await enrichReference("", { fetch }), {});
});
