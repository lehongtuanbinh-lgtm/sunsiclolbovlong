// --- PHẦN 1: CẤU HÌNH, UTILITIES, THUẬT TOÁN (FULL AI CHIP) VÀ LỚP LOGIC ---

import fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

// --- CẤU HÌNH ---
const port = 3000;
const api_url = "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1"; 

// --- GLOBAL STATE ---
let txh_history = []; 
let current_session_id = null; 
let fetch_interval = null; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- UTILITIES ---
function parse_lines(data) {
    // Giả định cấu trúc data.data.resultList là một Array
    if (!data || !data.data || !Array.isArray(data.data.resultList)) return [];
    
    const sorted_list = data.data.resultList.sort((a, b) => {
        // Trích xuất số từ gameNum (ví dụ: '#2319259' -> 2319259)
        const id_a = parseInt(a.gameNum.slice(1));
        const id_b = parseInt(b.gameNum.slice(1));
        return id_b - id_a; // Sắp xếp giảm dần (mới nhất lên đầu)
    });

    const arr = sorted_list.map(item => {
        const total = item.score;
        let tx;
        let result_truyen_thong;
        
        // Quy tắc Tài/Xỉu: Xỉu 4-10, Tài 11-17
        if (total >= 4 && total <= 10) {
            tx = 'X'; // Xỉu
            result_truyen_thong = "XIU";
        } else if (total >= 11 && total <= 17) {
            tx = 'T'; // Tài
            result_truyen_thong = "TAI";
        } else if (total === 3 || total === 18) {
            tx = 'B'; // Bão
            result_truyen_thong = "BAO";
        } else {
            tx = 'N'; 
            result_truyen_thong = "UNKNOWN";
        }
        
        // item.facesList trong API mới là [3,6,1], cần chuyển thành array các số
        const dice_faces = Array.isArray(item.facesList) ? item.facesList : 
                           (typeof item.keyR === 'string' ? item.keyR.split('-').map(Number) : [0, 0, 0]);


        return {
            session: parseInt(item.gameNum.slice(1)), 
            dice: dice_faces,
            total: total,
            result: result_truyen_thong, 
            tx: tx 
        };
    });

    // Trả về theo thứ tự tăng dần của session (cũ nhất lên đầu)
    return arr.sort((a, b) => a.session - b.session);
}

function last_n(arr, n) {
    return arr.slice(Math.max(0, arr.length - n));
}

function majority(obj) {
    let max_k = null,
        max_v = -Infinity;
    for (const k in obj)
        if (obj[k] > max_v) {
            max_v = obj[k];
            max_k = k;
        }
    return {
        key: max_k,
        val: max_v
    };
}

function sum(nums) {
    return nums.reduce((a, b) => a + b, 0);
}

function avg(nums) {
    return nums.length ? sum(nums) / nums.length : 0;
}

function entropy(arr) {
    if (!arr.length) return 0;
    const freq = arr.reduce((a, v) => {
        a[v] = (a[v] || 0) + 1;
        return a;
    }, {});
    const n = arr.length;
    let e = 0;
    for (const k in freq) {
        const p = freq[k] / n;
        e -= p * Math.log2(p);
    }
    return e;
}

function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let m = 0;
    for (let i = 0; i < a.length; i++)
        if (a[i] === b[i]) m++;
    return m / a.length;
}

function extract_features(history) {
    const tx_filtered = history.filter(h => h.tx !== 'B'); 
    const tx = tx_filtered.map(h => h.tx);
    const totals = tx_filtered.map(h => h.total);
    const features = {
        tx,
        totals,
        freq: tx.reduce((a, v) => {
            a[v] = (a[v] || 0) + 1;
            return a;
        }, {})
    };

    let runs = [],
        cur = tx[0],
        len = 1;
    for (let i = 1; i < tx.length; i++) {
        if (tx[i] === cur) len++;
        else {
            runs.push({
                val: cur,
                len
            });
            cur = tx[i];
            len = 1;
        }
    }
    if (tx.length) runs.push({
        val: cur,
        len
    });
    features.runs = runs;
    features.max_run = runs.reduce((m, r) => Math.max(m, r.len), 0) || 0;

    features.mean_total = avg(totals);
    features.std_total = Math.sqrt(avg(totals.map(t => Math.pow(t - features.mean_total, 2))));
    features.entropy = entropy(tx);

    return features;
}

// --- CORE ALGORITHMS (FULL AI CHIP DỰ ĐOÁN TÀI/XỈU - GIỮ NGUYÊN 100%) ---
// 1. Thuật toán cân bằng tần suất (Frequency Rebalance)
function algo5_freq_rebalance(history) {
    const tx = extract_features(history).tx;
    const freq = tx.reduce((a, v) => { a[v] = (a[v] || 0) + 1; return a; }, {});
    if ((freq['T'] || 0) > (freq['X'] || 0) + 2) return 'X';
    if ((freq['X'] || 0) > (freq['T'] || 0) + 2) return 'T';
    return null;
}

// 2. Thuật toán Markov
function algoa_markov(history) {
    const tx = extract_features(history).tx;
    const order = 3;
    if (tx.length < order + 1) return null;
    const transitions = {};
    for (let i = 0; i <= tx.length - order - 1; i++) {
        const key = tx.slice(i, i + order).join('');
        const next = tx[i + order];
        transitions[key] = transitions[key] || { t: 0, x: 0 };
        transitions[key][next.toLowerCase()]++;
    }
    const last_key = tx.slice(-order).join('');
    const counts = transitions[last_key];
    if (!counts) return null;
    return (counts['t'] > counts['x']) ? 'T' : 'X';
}

// 3. Thuật toán N-Gram Pattern Matching
function algob_ngram(history) {
    const tx = extract_features(history).tx;
    const k = 4;
    if (tx.length < k + 1) return null;
    const last_gram = tx.slice(-k).join('');
    let counts = { t: 0, x: 0 };
    for (let i = 0; i <= tx.length - k - 1; i++) {
        const gram = tx.slice(i, i + k).join('');
        if (gram === last_gram) counts[tx[i + k].toLowerCase()]++;
    }
    return counts.t > counts.x ? 'T' : 'X';
}

// 4. Thuật toán Neo Pattern Matching (Similarity-based)
function algos_neo_pattern(history) {
    const tx = extract_features(history).tx;
    const len = tx.length;
    if (len < 20) return null;

    const pattern_lengths = [4, 6];
    let best_pred = null;
    let max_matches = -1;

    for (const pat_len of pattern_lengths) {
        if (len < pat_len * 2 + 1) continue;
        const target_pattern = tx.slice(-pat_len).join('');
        let counts = { t: 0, x: 0 };

        for (let i = 0; i <= len - pat_len - 1; i++) {
            const history_pattern = tx.slice(i, i + pat_len).join('');
            const score = similarity(history_pattern, target_pattern); 

            if (score >= 0.75) { 
                counts[tx[i + pat_len].toLowerCase()]++;
            }
        }

        if (counts.t !== counts.x) {
            const current_matches = counts.t + counts.x;
            if (current_matches > max_matches) {
                max_matches = current_matches;
                best_pred = counts.t > counts.x ? 'T' : 'X';
            }
        }
    }

    return best_pred;
}

// 5. Thuật toán Super Deep Analysis (Entropy & Total Mean)
function algof_super_deep_analysis(history) {
    if (history.length < 70) return null;
    const features = extract_features(history);
    const tx = features.tx;
    const mean_total = features.mean_total;
    const recent_totals = features.totals.slice(-20);
    const recent_avg = avg(recent_totals);
    
    if (recent_avg > 13.0 && mean_total > 11.5) return 'X'; 
    if (recent_avg < 8.0 && mean_total < 10.5) return 'T'; 

    if (features.entropy > 0.98) {
        return tx.at(-1) === 'T' ? 'X' : 'T'; 
    }

    return null;
}

// 6. Thuật toán Transformer (Weighted Similarity)
function algoe_transformer(history) {
    const tx = extract_features(history).tx;
    const len = tx.length;
    if (len < 100) return null; 

    const target_seq = tx.slice(-10).join(''); 
    let counts = { t: 0, x: 0 };
    let total_weight = 0;

    for (let i = 0; i <= len - 11; i++) {
        const history_seq = tx.slice(i, i + 10).join('');
        const score = similarity(history_seq, target_seq); 

        if (score > 0.6) {
            const next_result = tx[i + 10];
            const weight = score * (1 / (len - i)); 
            counts[next_result.toLowerCase()] = (counts[next_result.toLowerCase()] || 0) + weight;
            total_weight += weight;
        }
    }

    if (total_weight > 0 && counts.t !== counts.x) {
        return counts.t > counts.x ? 'T' : 'X';
    }

    return null;
}

// 7. Thuật toán Super Bridge Predictor (Run Length)
function algog_super_bridge_predictor(history) {
    const runs = extract_features(history).runs;
    if (runs.length < 2) return null;
    const last_run = runs.at(-1);

    if (last_run.len >= 4) {
        return last_run.val;
    }

    if (runs.length >= 4) {
        const last_4_runs = runs.slice(-4);
        const is_1_1_pattern = last_4_runs.length === 4 && last_4_runs.every(r => r.len === 1);
        
        if (is_1_1_pattern) {
            return last_run.val === 'T' ? 'X' : 'T';
        }
        
        if (last_run.len >= 6) {
            return last_run.val === 'T' ? 'X' : 'T'; 
        }
    }
    
    return null;
}

// 8. Thuật toán Adaptive Markov
function algo_h_adaptive_markov(history) {
    const tx = extract_features(history).tx;
    if (tx.length < 20) return null;

    let best_pred = null;
    let max_confidence = -1;

    for (let order = 2; order <= 4; order++) {
        if (tx.length < order + 1) continue;
        const transitions = {};
        for (let i = 0; i <= tx.length - order - 1; i++) {
            const key = tx.slice(i, i + order).join('');
            const next = tx[i + order];
            transitions[key] = transitions[key] || { t: 0, x: 0 };
            transitions[key][next.toLowerCase()]++;
        }
        
        const last_key = tx.slice(-order).join('');
        const counts = transitions[last_key];
        
        if (counts && counts.t !== counts.x) {
            const total = counts.t + counts.x;
            const pred = counts.t > counts.x ? 'T' : 'X';
            const confidence = Math.abs(counts.t - counts.x) / total;
            
            if (confidence > max_confidence) {
                max_confidence = confidence;
                best_pred = pred;
            }
        }
    }

    return best_pred;
}

// 9. 🚨 THUẬT TOÁN MỚI (AI MẠNH NHẤT - SUPER DYNAMIC): Dự đoán 3 Vị (TỔNG ĐIỂM)
function algod_score_predictor(history, tx_constraint) {
    const xiu_scores = [4, 5, 6, 7, 8, 9, 10];
    const tai_scores = [11, 12, 13, 14, 15, 16, 17];
    
    const available_scores = tx_constraint === 'T' ? tai_scores : xiu_scores;

    if (available_scores.length < 3) return [null, null, null];

    const target_tx = tx_constraint; 
    let score_weighted_counts = {}; 
    
    // Phân tích lịch sử với trọng số thời gian (time decay)
    const lookback = Math.min(history.length, 100); 

    for (let i = history.length - 2; i >= history.length - lookback && i >= 0; i--) {
        const previous_result = history[i].tx;
        const current_score = history[i + 1].total;
        
        // Trọng số phân rã theo thời gian: Mới nhất (age=0) có trọng số gần 1.0
        const age = history.length - 1 - i;
        const decay_factor = 1.0 - (age / lookback); 
        
        if (previous_result === target_tx && available_scores.includes(current_score)) {
            score_weighted_counts[current_score] = (score_weighted_counts[current_score] || 0) + decay_factor;
        }
    }
    
    // Chọn Top 3 Điểm có trọng số cao nhất
    const sorted_scores = Object.keys(score_weighted_counts)
        .sort((a, b) => score_weighted_counts[b] - score_weighted_counts[a])
        .map(s => parseInt(s));

    let final_scores = sorted_scores.slice(0, 3);
    
    // Bổ sung nếu thiếu (Ưu tiên các điểm trung bình trong phạm vi)
    let used_scores = new Set(final_scores);
    let remaining_scores = available_scores.filter(s => !used_scores.has(s));
    
    // Sắp xếp ưu tiên các điểm ở giữa phạm vi Tài/Xỉu
    remaining_scores.sort((a, b) => {
        const center = (available_scores[0] + available_scores.at(-1)) / 2;
        return Math.abs(a - center) - Math.abs(b - center);
    });

    while (final_scores.length < 3 && remaining_scores.length > 0) {
        final_scores.push(remaining_scores.shift());
    }

    if (final_scores.length < 3) {
         return available_scores.slice(0, 3);
    }
    
    return final_scores;
}

// 10. 👑 VIP PATTERN RECOGNITION (TÍCH HỢP FULL TRỌNG SỐ TỪ YÊU CẦU CỦA BẠN)
function algo_i_vip_pattern_recognition(history) {
    const features = extract_features(history);
    const tx = features.tx;
    if (tx.length < 20) return null;

    const str_tx = tx.join('');
    let score_T = 0;
    let score_X = 0;

    // Bảng trọng số chuẩn VIP
    const W = {
        cau_bet: 1.3, cau_dao_11: 1.2, cau_22: 1.15, cau_33: 1.2, cau_121: 1.1, cau_123: 1.1, cau_321: 1.1,
        cau_nhay_coc: 1.0, cau_nhip_nghieng: 1.15, cau_3van1: 1.2, cau_be_cau: 1.25, cau_chu_ky: 1.1,
        distribution: 0.9, dice_pattern: 1.0, sum_trend: 1.05, edge_cases: 1.1, momentum: 1.15,
        cau_tu_nhien: 0.8, dice_trend_line: 1.2, break_pattern: 1.3, fibonacci: 1.0, resistance_support: 1.15,
        wave: 1.1, golden_ratio: 1.0, day_gay: 1.25, cau_44: 1.2, cau_55: 1.25, cau_212: 1.1, cau_1221: 1.15,
        cau_2112: 1.15, cau_gap: 1.1, cau_ziczac: 1.2, cau_doi: 1.15, cau_rong: 1.3, smart_bet: 1.2,
        markov_chain: 1.35, moving_avg_drift: 1.2, sum_pressure: 1.25, volatility: 1.15, sun_hot_cold: 1.3,
        sun_streak_break: 1.35, sun_balance: 1.2, sun_momentum_shift: 1.25
    };

    const add_score = (pred, weight_key) => {
        if (pred === 'T') score_T += W[weight_key];
        if (pred === 'X') score_X += W[weight_key];
    };

    // QUÉT MẪU CẦU TỪ ĐUÔI (STRING MATCHING) - TÍNH TOÁN VIP
    
    // 1. Cầu Bệt & Break Pattern (Bẻ cầu / Streak Break)
    if (str_tx.endsWith('TTTT')) { add_score('T', 'cau_bet'); add_score('X', 'break_pattern'); add_score('X', 'sun_streak_break'); add_score('X', 'cau_be_cau'); }
    if (str_tx.endsWith('XXXX')) { add_score('X', 'cau_bet'); add_score('T', 'break_pattern'); add_score('T', 'sun_streak_break'); add_score('T', 'cau_be_cau'); }
    
    // Cầu Rồng (Bệt siêu dài >= 6)
    if (str_tx.endsWith('TTTTTT')) add_score('T', 'cau_rong');
    if (str_tx.endsWith('XXXXXX')) add_score('X', 'cau_rong');

    // 2. Cầu Đảo 1-1 (Ziczac)
    if (str_tx.endsWith('TXTX') || str_tx.endsWith('XTXT')) {
        const next = str_tx.endsWith('TXTX') ? 'T' : 'X';
        add_score(next, 'cau_dao_11');
        add_score(next, 'cau_ziczac');
    }

    // 3. Cầu 2-2 (Đôi)
    if (str_tx.endsWith('TTXX')) { add_score('T', 'cau_22'); add_score('T', 'cau_doi'); }
    if (str_tx.endsWith('XXTT')) { add_score('X', 'cau_22'); add_score('X', 'cau_doi'); }

    // 4. Cầu 3-3 & 4-4 & 5-5
    if (str_tx.endsWith('TTTXXX')) add_score('T', 'cau_33');
    if (str_tx.endsWith('XXXTTT')) add_score('X', 'cau_33');
    if (str_tx.endsWith('TTTTXXXX')) add_score('T', 'cau_44');
    if (str_tx.endsWith('XXXXTTTT')) add_score('X', 'cau_44');
    if (str_tx.endsWith('TTTTTXXXXX')) add_score('T', 'cau_55');
    if (str_tx.endsWith('XXXXXTTTTT')) add_score('X', 'cau_55');

    // 5. Các dạng cầu phức tạp: 1-2-1, 1-2-3, 3-2-1, 2-1-2, 1-2-2-1, 2-1-1-2
    if (str_tx.endsWith('TXXT')) add_score('X', 'cau_121');
    if (str_tx.endsWith('XTTX')) add_score('T', 'cau_121');
    if (str_tx.endsWith('TXXTTT')) add_score('X', 'cau_123');
    if (str_tx.endsWith('XTTXXX')) add_score('T', 'cau_123');
    if (str_tx.endsWith('TTTXXT')) add_score('X', 'cau_321');
    if (str_tx.endsWith('XXXTTX')) add_score('T', 'cau_321');
    if (str_tx.endsWith('TTXT')) add_score('T', 'cau_212');
    if (str_tx.endsWith('XXTX')) add_score('X', 'cau_212');
    if (str_tx.endsWith('TXXTTX')) add_score('T', 'cau_1221');
    if (str_tx.endsWith('XTTXXT')) add_score('X', 'cau_1221');
    if (str_tx.endsWith('TTXTT')) add_score('X', 'cau_2112'); // Dễ gãy
    if (str_tx.endsWith('XXTXX')) add_score('T', 'cau_2112');

    // 6. Nhịp nghiêng (Momentum, Drift) & Sun Hot/Cold
    const recent_10 = tx.slice(-10);
    const count_T_10 = recent_10.filter(x => x === 'T').length;
    if (count_T_10 >= 7) { 
        add_score('T', 'cau_nhip_nghieng'); add_score('T', 'momentum'); 
        add_score('T', 'moving_avg_drift'); add_score('T', 'sun_hot_cold'); 
    }
    if (count_T_10 <= 3) { 
        add_score('X', 'cau_nhip_nghieng'); add_score('X', 'momentum'); 
        add_score('X', 'moving_avg_drift'); add_score('X', 'sun_hot_cold'); 
    }

    // 7. Cân bằng (Sun Balance / Distribution / Cau tu nhien)
    const count_T_total = tx.filter(x => x === 'T').length;
    const count_X_total = tx.length - count_T_total;
    if (count_T_total > count_X_total + 5) { add_score('X', 'sun_balance'); add_score('X', 'distribution'); add_score('X', 'cau_tu_nhien'); }
    if (count_X_total > count_T_total + 5) { add_score('T', 'sun_balance'); add_score('T', 'distribution'); add_score('T', 'cau_tu_nhien'); }

    // 8. Động lực tổng điểm (Sum Trend & Sum Pressure)
    const totals = features.totals.slice(-5);
    if (totals.length === 5) {
        const trend = totals[4] - totals[0];
        if (trend > 4) { add_score('T', 'sum_trend'); add_score('T', 'sum_pressure'); add_score('T', 'dice_trend_line'); }
        if (trend < -4) { add_score('X', 'sum_trend'); add_score('X', 'sum_pressure'); add_score('X', 'dice_trend_line'); }
    }

    // 9. Chu kỳ và Điểm hỗ trợ / Kháng cự (Support / Resistance / Wave / Fibonacci)
    if (features.totals[features.totals.length - 1] >= 16) { add_score('X', 'resistance_support'); add_score('X', 'wave'); } // Kháng cự cứng
    if (features.totals[features.totals.length - 1] <= 5) { add_score('T', 'resistance_support'); add_score('T', 'wave'); } // Hỗ trợ cứng
    
    // 10. Smart Bet & Markov & Edge Cases
    if (score_T > 0 || score_X > 0) {
        // Áp dụng các trọng số động cuối cùng dựa trên ưu thế hiện tại
        const dom = score_T > score_X ? 'T' : 'X';
        add_score(dom, 'smart_bet');
        add_score(dom, 'markov_chain');
        add_score(dom, 'edge_cases');
        add_score(dom, 'volatility');
        add_score(dom, 'sun_momentum_shift');
        add_score(dom, 'golden_ratio');
        add_score(dom, 'cau_chu_ky');
    }

    if (score_T === score_X) return null;
    return score_T > score_X ? 'T' : 'X';
}


// --- DANH SÁCH THUẬT TOÁN KẾT HỢP (FULL THUẬT TOÁN TRỌNG SỐ) ---
const all_algs = [{
    id: 'algo5_freq_rebalance',
    fn: algo5_freq_rebalance
}, {
    id: 'a_markov',
    fn: algoa_markov
}, {
    id: 'b_ngram',
    fn: algob_ngram
}, {
    id: 's_neo_pattern',
    fn: algos_neo_pattern
}, {
    id: 'f_super_deep_analysis', 
    fn: algof_super_deep_analysis
}, {
    id: 'e_transformer', 
    fn: algoe_transformer
}, {
    id: 'g_super_bridge_predictor', 
    fn: algog_super_bridge_predictor
}, {
    id: 'h_adaptive_markov', 
    fn: algo_h_adaptive_markov
}, {
    id: 'i_vip_pattern_recognition', // Tích hợp thuật toán VIP Pattern mới
    fn: algo_i_vip_pattern_recognition
}];


// --- ENSEMBLE CLASSIFIER (AI HỌC CẦU VÀ TÍCH HỢP TRỌNG SỐ) ---
class SeiuEnsemble {
    constructor(algorithms, opts = {}) { 
        this.algs = algorithms;
        this.weights = {};
        this.ema_alpha = opts.ema_alpha ?? 0.1;
        this.min_weight = opts.min_weight ?? 0.001;
        this.history_window = opts.history_window ?? 500;
        for (const a of algorithms) this.weights[a.id] = 1;
    }
    
    fit_initial(history) {
        const window = last_n(history.filter(h => h.tx !== 'B'), this.history_window);
        if (window.length < 10) return;
        const alg_scores = {};
        for (const a of this.algs) alg_scores[a.id] = 0;

        for (let i = 3; i < window.length; i++) {
            const prefix = window.slice(0, i);
            const actual = window[i].tx;
            for (const a of this.algs) {
                const pred = a.fn(prefix);
                if (pred && pred === actual) alg_scores[a.id]++;
            }
        }

        let total = 0;
        for (const id in alg_scores) {
            const w = (alg_scores[id] || 0) + 1;
            this.weights[id] = w;
            total += w;
        }
        for (const id in this.weights) this.weights[id] = Math.max(this.min_weight, this.weights[id] / total);
        console.log(`⚖️ Đã khởi tạo ${Object.keys(this.weights).length} trọng số cho full ai chip (bao gồm VIP Pattern).`);
    }

    update_with_outcome(history_prefix, actual_tx) {
        if (actual_tx === 'B') return; 
        
        for (const a of this.algs) {
            const pred = a.fn(history_prefix);
            const correct = pred === actual_tx ? 1 : 0;
            const current_weight = this.weights[a.id] || this.min_weight;

            const reward = correct ? 1.05 : 0.95;
            const target_weight = current_weight * reward;

            const nw = this.ema_alpha * target_weight + (1 - this.ema_alpha) * current_weight;

            this.weights[a.id] = Math.max(this.min_weight, nw);
        }

        const s = Object.values(this.weights).reduce((a, b) => a + b, 0) || 1;
        for (const id in this.weights) this.weights[id] /= s; 
    }

    predict(history) {
        const votes = {};
        for (const a of this.algs) {
            const pred = a.fn(history);
            if (!pred) continue;
            votes[pred] = (votes[pred] || 0) + (this.weights[a.id] || 0);
        }

        let best, confidence;

        if (!votes['T'] && !votes['X']) {
            best = algo5_freq_rebalance(history) || 'T';
            confidence = 0.5;
        } else {
            const result = majority(votes);
            best = result.key;
            const total = Object.values(votes).reduce((a, b) => a + b, 0);
            confidence = Math.min(0.99, Math.max(0.51, total > 0 ? result.val / total : 0.51));
        }

        // 🚨 GỌI HÀM DỰ ĐOÁN 3 VỊ (TỔNG ĐIỂM) SUPER DYNAMIC
        const score_prediction = algod_score_predictor(history, best); 

        return {
            prediction: best === 'T' ? 'tài' : 'xỉu',
            confidence,
            raw_prediction: best,
            score_prediction 
        };
    }
}

// --- MANAGER CLASS ---
class SeiuManager {
    constructor(opts = {}) {
        this.history = [];
        this.ensemble = new SeiuEnsemble(all_algs, {
            ema_alpha: opts.ema_alpha ?? 0.1,
            history_window: opts.history_window ?? 500
        });
        this.current_prediction = null;
    }
    
    calculate_initial_stats() {
        const min_start = 10;
        const filtered_history = this.history.filter(h => h.tx !== 'B');

        if (filtered_history.length < min_start) return;
        
        for (let i = min_start; i < filtered_history.length; i++) {
            const history_prefix = filtered_history.slice(0, i);
            const actual_tx = filtered_history[i].tx;
            this.ensemble.update_with_outcome(history_prefix, actual_tx);
        }
        console.log(`📊 ai chip đã hoàn tất huấn luyện trên lịch sử.`);
    }

    load_initial(lines) {
        this.history = lines;
        this.ensemble.fit_initial(this.history);
        this.calculate_initial_stats();
        this.current_prediction = this.get_prediction();
        console.log("📦 đã tải lịch sử. hệ thống sẵn sàng.");
        const next_session = this.history.at(-1) ? this.history.at(-1).session + 1 : 'n/a';
        const score_pred_str = this.current_prediction.score_prediction.join('-');
        console.log(`🔮 dự đoán phiên tiếp theo (${next_session}): ${this.current_prediction.prediction} (tỷ lệ: ${(this.current_prediction.confidence * 100).toFixed(0)}%). vị (tổng điểm): [${score_pred_str}]`);
    }

    push_record(record) {
        this.history.push(record);

        const prefix = this.history.slice(0, -1).filter(h => h.tx !== 'B');
        if (prefix.length >= 3) {
            this.ensemble.update_with_outcome(prefix, record.tx);
        }
        
        this.current_prediction = this.get_prediction();
        const score_pred_str = this.current_prediction.score_prediction.join('-');
        console.log(`📥 phiên mới ${record.session} → ${record.result.toLowerCase()}. dự đoán phiên ${record.session + 1} là: ${this.current_prediction.prediction}. vị (tổng điểm): [${score_pred_str}]`);
    }

    get_prediction() {
        return this.ensemble.predict(this.history);
    }
}

const seiu_manager = new SeiuManager();


// --- PHẦN 2: API SERVER VÀ LOGIC TẢI DỮ LIỆU ĐỊNH KỲ ---

const app = fastify({
    logger: true
});
await app.register(cors, {
    origin: "*"
});

/**
 * Hàm lấy dữ liệu lịch sử và cập nhật AI
 */
async function fetch_and_process_history() {
    try {
        const response = await fetch(api_url);
        const data = await response.json();
        const new_history = parse_lines(data); 
        
        if (new_history.length === 0) {
            console.log("⚠️ không có dữ liệu lịch sử từ api.");
            return;
        }

        const last_session_in_history = new_history.at(-1);

        if (!current_session_id) {
            seiu_manager.load_initial(new_history);
            txh_history = new_history;
            current_session_id = last_session_in_history.session;
            console.log(`✅ lần đầu tải ${new_history.length} phiên.`);
        } else if (last_session_in_history.session > current_session_id) {
            const new_records = new_history.filter(r => r.session > current_session_id);
            
            for (const record of new_records) {
                seiu_manager.push_record(record);
                txh_history.push(record);
            }
            if (txh_history.length > 200) {
                txh_history = txh_history.slice(txh_history.length - 200);
            }
            current_session_id = last_session_in_history.session;
            console.log(`🆕 đã cập nhật ${new_records.length} phiên mới. phiên cuối: ${current_session_id}`);
        } else {
            console.log(`🔄 không có phiên mới. phiên cuối: ${current_session_id}`);
        }

    } catch (e) {
        console.error("❌ lỗi khi lấy hoặc xử lý lịch sử:", e.message);
    }
}

// Lấy dữ liệu lần đầu
fetch_and_process_history();

// Thiết lập việc lấy dữ liệu định kỳ (mỗi 5 giây)
clearInterval(fetch_interval);
fetch_interval = setInterval(fetch_and_process_history, 5000); 
console.log(`🔄 đang thiết lập fetch api mỗi 5 giây tại url: ${api_url}`);

// GET /api/sicbo/sunwin (ENDPOINT DỰ ĐOÁN CHÍNH ĐÃ CẬP NHẬT)
app.get("/api/sicbo/sunwin", async () => {
    const last_result = txh_history.at(-1) || null; 
    const current_prediction = seiu_manager.current_prediction;
    
    // Dự đoán 3 Vị (Tổng điểm)
    const score_pred_str = current_prediction?.score_prediction ? current_prediction.score_prediction.join('-') : 'chưa có';
    
    if (!last_result || !current_prediction) {
        return {
            "id": "@anhphong29",
            "phien": null,
            "xuc_xac1": null,
            "xuc_xac2": null,
            "xuc_xac3": null,
            "tong": null,
            "ket_qua": "đang chờ dữ liệu",
            "phien_hien_tai": current_session_id ? current_session_id + 1 : null,
            "du_doan": "chưa có",
            "du_doan_vi": score_pred_str,
            "do_tin_cay": "0%"
        };
    }

    // 🚨 ĐỊNH DẠNG OUTPUT THEO YÊU CẦU CỦA BẠN (TOÀN BỘ CHỮ THƯỜNG)
    return {
        "id": "@cskhvilong",
        "phien": last_result.session,
        "xuc_xac1": last_result.dice[0],
        "xuc_xac2": last_result.dice[1],
        "xuc_xac3": last_result.dice[2],
        "tong": last_result.total,
        "ket_qua": last_result.result.toLowerCase(),
        "phien_hien_tai": last_result.session + 1,
        "du_doan": current_prediction.prediction,
        "du_doan_vi": score_pred_str, 
        "do_tin_cay": `${(current_prediction.confidence * 100).toFixed(0)}%`,
    };
});

// GET /api/sicsun/history (ENDPOINT LỊCH SỬ ĐÃ CẬP NHẬT)
app.get("/api/sicsun/history", async () => { 
    if (!txh_history.length) return {
        message: "không có dữ liệu lịch sử."
    };
    const reversed_history = [...txh_history].sort((a, b) => b.session - a.session);
    
    return reversed_history.map((i) => ({
        session: i.session,
        dice: i.dice,
        total: i.total,
        result: i.result.toLowerCase(),
        tx_label: i.tx.toLowerCase(),
    }));
});

// GET /
app.get("/", async () => { 
    return {
        status: "ok",
        msg: "server chạy thành công 🚀"
    };
});

// --- SERVER START ---
const start = async () => {
    try {
        await app.listen({
            port: port,
            host: "0.0.0.0"
        });
    } catch (err) {
        const fs = await import("node:fs");
        const log_file = path.join(__dirname, "server-error.log");
        const error_msg = `
================= SERVER ERROR =================
time: ${new Date().toISOString()}
error: ${err.message}
stack: ${err.stack}
=================================================
`;
        console.error(error_msg);
        fs.writeFileSync(log_file, error_msg, {
            encoding: "utf8",
            flag: "a+"
        });
        process.exit(1);
    }

    let public_ip = "0.0.0.0";
    try {
        const res = await fetch("https://ifconfig.me/ip");
        public_ip = (await res.text()).trim();
    } catch (e) {
        console.error("❌ lỗi lấy public ip:", e.message);
    }

    console.log("\n🚀 server đã chạy thành công!");
    console.log(`   ➜ local:   http://localhost:${port}/`);
    console.log(`   ➜ network: http://${public_ip}:${port}/\n`);

    console.log("📌 các api endpoints:");
    console.log(`   ➜ get /api/sicbo/sunwin   → http://${public_ip}:${port}/api/sicbo/sunwin`);
    console.log(`   ➜ get /api/sicsun/history   → http://${public_ip}:${port}/api/sicsun/history`);
};

start();