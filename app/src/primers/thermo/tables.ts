/**
 * Nearest-neighbour parameter tables for DNA/DNA duplexes.
 *
 * Transcribed from Biopython's Bio/SeqUtils/MeltingTemp.py, which collects
 * them from the papers cited on each table. Inosine entries are left out.
 * Values are [ΔH kcal/mol, ΔS cal/(mol·K)].
 *
 * Keys read as a duplex: "XY/ZW" is 5'-XY-3' on top over 3'-ZW-5' below, so
 * "AG/TT" is an A·T pair followed by a G·T mismatch. A '.' is a missing base
 * (a dangling end).
 *
 * ---------------------------------------------------------------------------
 * The tables below are derived from Biopython:
 *   Copyright 2004-2008 by Sebastian Bassi.
 *   Copyright 2013-2018 by Markus Piotrowski.
 *   All rights reserved.
 * Used under the BSD 3-Clause License:
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are
 *   met: (1) redistributions of source code must retain the above copyright
 *   notice, this list of conditions and the following disclaimer;
 *   (2) redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution;
 *   (3) neither the name of the copyright holder nor the names of its
 *   contributors may be used to endorse or promote products derived from this
 *   software without specific prior written permission.
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
 *   IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 *   THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 *   PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 *   CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 *   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 *   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *   PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 *   LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 *   NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 *   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * ---------------------------------------------------------------------------
 */

export type Params = readonly [dH: number, dS: number]
export type Table = Readonly<Record<string, Params>>

/**
 * Watson-Crick pairs and initiation.
 * Allawi & SantaLucia (1997), Biochemistry 36: 10581-10594 (Biopython DNA_NN3),
 * the same unified parameters the app has always used.
 */
export const DNA_NN: Table = {
  'init': [0, 0], 'init_A/T': [2.3, 4.1], 'init_G/C': [0.1, -2.8],
  'sym': [0, -1.4],
  'AA/TT': [-7.9, -22.2], 'AT/TA': [-7.2, -20.4], 'TA/AT': [-7.2, -21.3],
  'CA/GT': [-8.5, -22.7], 'GT/CA': [-8.4, -22.4], 'CT/GA': [-7.8, -21.0],
  'GA/CT': [-8.2, -22.2], 'CG/GC': [-10.6, -27.2], 'GC/CG': [-9.8, -24.4],
  'GG/CC': [-8.0, -19.9],
}

/**
 * Internal single mismatches.
 * Allawi & SantaLucia (1997), Biochemistry 36: 10581-10594;
 * Allawi & SantaLucia (1998), Biochemistry 37: 9435-9444;
 * Allawi & SantaLucia (1998), Biochemistry 37: 2170-2179;
 * Allawi & SantaLucia (1998), Nucl Acids Res 26: 2694-2701;
 * Peyret et al. (1999), Biochemistry 38: 3468-3477.
 */
export const DNA_IMM: Table = {
  'AG/TT': [1.0, 0.9], 'AT/TG': [-2.5, -8.3], 'CG/GT': [-4.1, -11.7],
  'CT/GG': [-2.8, -8.0], 'GG/CT': [3.3, 10.4], 'GG/TT': [5.8, 16.3],
  'GT/CG': [-4.4, -12.3], 'GT/TG': [4.1, 9.5], 'TG/AT': [-0.1, -1.7],
  'TG/GT': [-1.4, -6.2], 'TT/AG': [-1.3, -5.3], 'AA/TG': [-0.6, -2.3],
  'AG/TA': [-0.7, -2.3], 'CA/GG': [-0.7, -2.3], 'CG/GA': [-4.0, -13.2],
  'GA/CG': [-0.6, -1.0], 'GG/CA': [0.5, 3.2], 'TA/AG': [0.7, 0.7],
  'TG/AA': [3.0, 7.4],
  'AC/TT': [0.7, 0.2], 'AT/TC': [-1.2, -6.2], 'CC/GT': [-0.8, -4.5],
  'CT/GC': [-1.5, -6.1], 'GC/CT': [2.3, 5.4], 'GT/CC': [5.2, 13.5],
  'TC/AT': [1.2, 0.7], 'TT/AC': [1.0, 0.7],
  'AA/TC': [2.3, 4.6], 'AC/TA': [5.3, 14.6], 'CA/GC': [1.9, 3.7],
  'CC/GA': [0.6, -0.6], 'GA/CC': [5.2, 14.2], 'GC/CA': [-0.7, -3.8],
  'TA/AC': [3.4, 8.0], 'TC/AA': [7.6, 20.2],
  'AA/TA': [1.2, 1.7], 'CA/GA': [-0.9, -4.2], 'GA/CA': [-2.9, -9.8],
  'TA/AA': [4.7, 12.9], 'AC/TC': [0.0, -4.4], 'CC/GC': [-1.5, -7.2],
  'GC/CC': [3.6, 8.9], 'TC/AC': [6.1, 16.4], 'AG/TG': [-3.1, -9.5],
  'CG/GG': [-4.9, -15.3], 'GG/CG': [-6.0, -15.8], 'TG/AG': [1.6, 3.6],
  'AT/TT': [-2.7, -10.8], 'CT/GT': [-5.0, -15.8], 'GT/CT': [-2.2, -8.4],
  'TT/AT': [0.2, -1.5],
}

/** Terminal mismatches. SantaLucia & Peyret (2001), Patent Application WO 01/94611. */
export const DNA_TMM: Table = {
  'AA/TA': [-3.1, -7.8], 'TA/AA': [-2.5, -6.3], 'CA/GA': [-4.3, -10.7],
  'GA/CA': [-8.0, -22.5],
  'AC/TC': [-0.1, 0.5], 'TC/AC': [-0.7, -1.3], 'CC/GC': [-2.1, -5.1],
  'GC/CC': [-3.9, -10.6],
  'AG/TG': [-1.1, -2.1], 'TG/AG': [-1.1, -2.7], 'CG/GG': [-3.8, -9.5],
  'GG/CG': [-0.7, -19.2],
  'AT/TT': [-2.4, -6.5], 'TT/AT': [-3.2, -8.9], 'CT/GT': [-6.1, -16.9],
  'GT/CT': [-7.4, -21.2],
  'AA/TC': [-1.6, -4.0], 'AC/TA': [-1.8, -3.8], 'CA/GC': [-2.6, -5.9],
  'CC/GA': [-2.7, -6.0], 'GA/CC': [-5.0, -13.8], 'GC/CA': [-3.2, -7.1],
  'TA/AC': [-2.3, -5.9], 'TC/AA': [-2.7, -7.0],
  'AC/TT': [-0.9, -1.7], 'AT/TC': [-2.3, -6.3], 'CC/GT': [-3.2, -8.0],
  'CT/GC': [-3.9, -10.6], 'GC/CT': [-4.9, -13.5], 'GT/CC': [-3.0, -7.8],
  'TC/AT': [-2.5, -6.3], 'TT/AC': [-0.7, -1.2],
  'AA/TG': [-1.9, -4.4], 'AG/TA': [-2.5, -5.9], 'CA/GG': [-3.9, -9.6],
  'CG/GA': [-6.0, -15.5], 'GA/CG': [-4.3, -11.1], 'GG/CA': [-4.6, -11.4],
  'TA/AG': [-2.0, -4.7], 'TG/AA': [-2.4, -5.8],
  'AG/TT': [-3.2, -8.7], 'AT/TG': [-3.5, -9.4], 'CG/GT': [-3.8, -9.0],
  'CT/GG': [-6.6, -18.7], 'GG/CT': [-5.7, -15.9], 'GT/CG': [-5.9, -16.1],
  'TG/AT': [-3.9, -10.5], 'TT/AG': [-3.6, -9.8],
}

/** Dangling ends. Bommarito et al. (2000), Nucl Acids Res 28: 1929-1934. */
export const DNA_DE: Table = {
  'AA/.T': [0.2, 2.3], 'AC/.G': [-6.3, -17.1], 'AG/.C': [-3.7, -10.0],
  'AT/.A': [-2.9, -7.6], 'CA/.T': [0.6, 3.3], 'CC/.G': [-4.4, -12.6],
  'CG/.C': [-4.0, -11.9], 'CT/.A': [-4.1, -13.0], 'GA/.T': [-1.1, -1.6],
  'GC/.G': [-5.1, -14.0], 'GG/.C': [-3.9, -10.9], 'GT/.A': [-4.2, -15.0],
  'TA/.T': [-6.9, -20.0], 'TC/.G': [-4.0, -10.9], 'TG/.C': [-4.9, -13.8],
  'TT/.A': [-0.2, -0.5],
  '.A/AT': [-0.7, -0.8], '.C/AG': [-2.1, -3.9], '.G/AC': [-5.9, -16.5],
  '.T/AA': [-0.5, -1.1], '.A/CT': [4.4, 14.9], '.C/CG': [-0.2, -0.1],
  '.G/CC': [-2.6, -7.4], '.T/CA': [4.7, 14.2], '.A/GT': [-1.6, -3.6],
  '.C/GG': [-3.9, -11.2], '.G/GC': [-3.2, -10.4], '.T/GA': [-4.1, -13.1],
  '.A/TT': [2.9, 10.4], '.C/TG': [-4.4, -13.1], '.G/TC': [-5.2, -15.0],
  '.T/TA': [-3.8, -12.6],
}
