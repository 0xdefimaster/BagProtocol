import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/landing/Hero";
import Philosophy from "@/components/landing/Philosophy";
import ForkTree from "@/components/landing/ForkTree";
import StrategyDNA from "@/components/landing/StrategyDNA";
import FileFormat from "@/components/landing/FileFormat";
import Spec from "@/components/landing/Spec";
import Lineage from "@/components/landing/Lineage";
import Flywheel from "@/components/landing/Flywheel";
import Creators from "@/components/landing/Creators";
import Roadmap from "@/components/landing/Roadmap";
import CTA from "@/components/landing/CTA";
import ScrollReveal from "@/components/animations/ScrollReveal";

export default function LandingPage() {
  return (
    <>
      <ScrollReveal />
      <Header />
      <main>
        <Hero />
        <Philosophy />
        <ForkTree />
        <StrategyDNA />
        <FileFormat />
        <Spec />
        <Lineage />
        <Flywheel />
        <Creators />
        <Roadmap />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
