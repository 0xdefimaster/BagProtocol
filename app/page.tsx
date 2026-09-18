import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/landing/Hero";
import GitHubForFinance from "@/components/landing/GitHubForFinance";
import BagAnatomy from "@/components/landing/BagAnatomy";
import HowItWorks from "@/components/landing/HowItWorks";
import Philosophy from "@/components/landing/Philosophy";
import ForkTree from "@/components/landing/ForkTree";
import CreatorRewards from "@/components/landing/CreatorRewards";
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
        <GitHubForFinance />
        <BagAnatomy />
        <HowItWorks />
        <Philosophy />
        <ForkTree />
        <CreatorRewards />
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
