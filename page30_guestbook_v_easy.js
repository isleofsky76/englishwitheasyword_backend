

///////////////////------------------------------------------------------

// API 베이스 URL 설정 (로컬/프로덕션 자동 전환)
// URL 파라미터로 강제 설정 가능: ?api=local 또는 ?api=prod
let API_BASE_URL;
const urlParams = new URLSearchParams(window.location.search);
const apiMode = urlParams.get('api'); // 'local' 또는 'prod'로 강제 설정 가능

if (apiMode === 'prod') {
    // URL 파라미터로 프로덕션 강제 지정
    API_BASE_URL = 'https://port-0-englishwitheasyword-backend-1272llwoib16o.sel5.cloudtype.app';
    console.log('🟢 Production 모드 (강제) - API_BASE_URL:', API_BASE_URL);
} else if (apiMode === 'local') {
    // URL 파라미터로 로컬 강제 지정
    API_BASE_URL = `http://${window.location.hostname}:3000`;
    console.log('🔵 Localhost 모드 (강제) - API_BASE_URL:', API_BASE_URL);
} else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // 자동 감지: 로컬 호스트면 로컬 API 사용
    API_BASE_URL = `http://${window.location.hostname}:3000`;
    console.log('🔵 Localhost 모드 (자동) - API_BASE_URL:', API_BASE_URL);
    console.log('💡 프로덕션 API를 사용하려면 URL에 ?api=prod 를 추가하세요');
} else {
    // 자동 감지: 프로덕션 호스트면 프로덕션 API 사용
    API_BASE_URL = 'https://port-0-englishwitheasyword-backend-1272llwoib16o.sel5.cloudtype.app';
    console.log('🟢 Production 모드 (자동) - API_BASE_URL:', API_BASE_URL);
}
console.log('page30_guestbook_v_easy.js v20260629');

// 성능 최적화: 캐시 및 상태 관리
const cache = {
    messages: null,
    lastFetch: null,
    cacheTime: 30000 // 30초 캐시
};

// HTML 이스케이프 헬퍼 함수 (전역)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// contentEditable에서 가져온 HTML을 정리하는 함수 (모바일 최적화)
function cleanHtml(html) {
    if (!html) return '';
    
    // 임시 div에 HTML 넣기
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // 불필요한 빈 태그 제거
    const emptyTags = tempDiv.querySelectorAll('div:empty, p:empty, span:empty, br:only-child');
    emptyTags.forEach(tag => {
        // 부모가 div나 p이고 자식이 br만 있는 경우
        if (tag.tagName === 'BR' && tag.parentElement && 
            (tag.parentElement.tagName === 'DIV' || tag.parentElement.tagName === 'P')) {
            if (tag.parentElement.children.length === 1) {
                tag.parentElement.remove();
            }
        } else {
            tag.remove();
        }
    });
    
    // 불필요한 wrapper div/p 제거 (텍스트만 있는 경우)
    const wrapperTags = tempDiv.querySelectorAll('div, p');
    wrapperTags.forEach(tag => {
        // 자식이 텍스트 노드만 있거나, span 하나만 있는 경우
        if (tag.children.length === 0 || 
            (tag.children.length === 1 && tag.children[0].tagName === 'SPAN' && 
             tag.textContent.trim() === tag.children[0].textContent.trim())) {
            const parent = tag.parentElement;
            if (parent && parent !== tempDiv) {
                tag.replaceWith(...Array.from(tag.childNodes));
            }
        }
    });
    
    // 연속된 공백과 줄바꿈 정리
    let cleaned = tempDiv.innerHTML;
    
    // 불필요한 <br> 태그 제거 (연속된 <br>)
    cleaned = cleaned.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
    
    // <div><br></div> 같은 빈 구조 제거
    cleaned = cleaned.replace(/<div[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '<br>');
    cleaned = cleaned.replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '<br>');
    cleaned = cleaned.replace(/<span[^>]*>\s*<br\s*\/?>\s*<\/span>/gi, '<br>');
    
    // 불필요한 style 속성 제거 (빈 style이나 기본값만 있는 경우)
    cleaned = cleaned.replace(/style\s*=\s*["'][^"']*["']/gi, (match) => {
        const styleContent = match.replace(/style\s*=\s*["']|["']/g, '');
        // 빈 style이나 의미 없는 style 제거
        if (!styleContent || styleContent.trim() === '' || 
            styleContent.includes('font-family:') && !styleContent.includes('color:') && !styleContent.includes('background')) {
            return '';
        }
        return match;
    });
    
    // 연속된 공백 정리 (HTML 태그 내부는 제외)
    cleaned = cleaned.replace(/(?![^<]*>)\s{2,}/g, ' ');
    
    // 시작과 끝의 불필요한 태그 제거
    cleaned = cleaned.trim();
    
    // 최종 크기 확인 및 경고
    const cleanedSize = new Blob([cleaned]).size;
    if (cleanedSize > 2 * 1024 * 1024) { // 2MB 초과 시
        console.warn('⚠️ 정리 후에도 메시지 크기가 큽니다:', (cleanedSize / 1024 / 1024).toFixed(2), 'MB');
    }
    
    return cleaned;
}

// 디바운스 함수
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 로딩 상태 표시 함수
function showLoading(container) {
    container.innerHTML = `
        <div class="loading-spinner" style="text-align: center; padding: 40px;">
            <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p style="margin-top: 15px; color: #666;">게시글을 불러오는 중...</p>
        </div>
    `;
}

// 에러 메시지 표시 함수
function showError(container, message, details = '') {
    container.innerHTML = `
        <div class="error-message" style="text-align: center; padding: 30px; color: #d32f2f; background-color: #ffebee; border-radius: 8px; margin: 20px;">
            <p style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">⚠️ ${message}</p>
            ${details ? `<p style="font-size: 0.9em; color: #666; margin-top: 10px;">${details}</p>` : ''}
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    const writePostContainer = document.getElementById('write-post-container');
    const editPostContainer = document.getElementById('edit-post-container');
    if (writePostContainer) writePostContainer.style.display = 'none';
    if (editPostContainer) editPostContainer.style.display = 'none';

    // URL 파라미터 확인
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === 'true' && editPostContainer) {
        const editId = document.getElementById('edit-id');
        const editTitle = document.getElementById('edit-title');
        const editMessage = document.getElementById('edit-message');
        const editNickname = document.getElementById('edit-nickname');
        const editIsSecret = document.getElementById('edit-isSecret');
        if (editId) editId.value = params.get('id');
        if (editTitle) editTitle.value = decodeURIComponent(params.get('title'));
        if (editMessage) editMessage.value = decodeURIComponent(params.get('message'));
        if (editNickname) editNickname.value = decodeURIComponent(params.get('nickname'));
        if (editIsSecret) editIsSecret.checked = params.get('isSecret') === 'true';
        editPostContainer.style.display = 'block';
    }

    const guestbookList = document.getElementById('guestbook-list');
    loadMessages();

    const writeModalElement = document.getElementById('write-post-modal');
    const writeModal = writeModalElement && window.bootstrap
        ? bootstrap.Modal.getOrCreateInstance(writeModalElement)
        : null;

    const writePostButton = document.getElementById('write-post-button');
    if (writePostButton && writeModal && guestbookList) {
        writePostButton.addEventListener('click', () => {
            guestbookList.style.display = 'none';
            writeModal.show();
            if (editPostContainer) editPostContainer.style.display = 'none';
            setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 300);
        });
    }

    if (writeModalElement && guestbookList) {
        writeModalElement.addEventListener('hidden.bs.modal', () => {
            guestbookList.style.display = 'block';
        });
    }
    
    // 텍스트 에디터 기능 추가
    const messageEditor = document.getElementById('message');
    const editorToolbar = document.querySelector('.editor-toolbar');
    
    // 선택 영역 저장 및 복원 함수
    function saveSelection() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && messageEditor.contains(selection.anchorNode)) {
            return selection.getRangeAt(0).cloneRange();
        }
        // 저장된 선택 영역이 있으면 사용
        if (savedSelection) {
            return savedSelection.cloneRange();
        }
        return null;
    }
    
    function restoreSelection(range) {
        if (range) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                savedSelection = range.cloneRange(); // 복원된 선택 영역 저장
            } catch (e) {
                console.warn('선택 영역 복원 실패:', e);
            }
        }
    }
    
    // 툴바 버튼 이벤트 핸들러
    if (editorToolbar) {
        // Bold, Italic, Underline 버튼
        editorToolbar.querySelectorAll('[data-command]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const command = btn.getAttribute('data-command');
                
                // 선택 영역 저장
                const savedRange = saveSelection();
                
                // 에디터에 포커스
                messageEditor.focus();
                
                // 선택 영역 복원
                if (savedRange) {
                    restoreSelection(savedRange);
                }
                
                // 서식 적용
                if (command === 'removeFormat') {
                    document.execCommand('removeFormat', false, null);
                } else {
                    document.execCommand(command, false, null);
                }
            });
        });
        
        // 텍스트 색상
        editorToolbar.querySelectorAll('[data-color]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const color = item.getAttribute('data-color');
                
                // 선택 영역 저장
                const savedRange = saveSelection();
                
                // 에디터에 포커스
                messageEditor.focus();
                
                // 선택 영역 복원
                if (savedRange) {
                    restoreSelection(savedRange);
                }
                
                // 색상 적용
                document.execCommand('foreColor', false, color);
            });
        });
        
        // 형광색 (배경색)
        editorToolbar.querySelectorAll('[data-highlight]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const color = item.getAttribute('data-highlight');
                
                // 선택 영역 저장
                const savedRange = saveSelection();
                
                // 에디터에 포커스
                messageEditor.focus();
                
                // 선택 영역 복원
                if (savedRange) {
                    restoreSelection(savedRange);
                }
                
                // 배경색 적용
                document.execCommand('backColor', false, color);
            });
        });
        
        // 폰트 크기
        editorToolbar.querySelectorAll('[data-size]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const size = item.getAttribute('data-size');
                
                // 선택 영역 저장
                const savedRange = saveSelection();
                
                // 에디터에 포커스
                messageEditor.focus();
                
                // 선택 영역 복원
                if (savedRange) {
                    restoreSelection(savedRange);
                }
                
                // 폰트 크기를 span 태그로 적용
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const selectedText = range.toString();
                    if (selectedText) {
                        const span = document.createElement('span');
                        span.style.fontSize = size;
                        span.textContent = selectedText;
                        range.deleteContents();
                        range.insertNode(span);
                        
                        // 선택 영역을 새로 삽입한 span으로 이동
                        const newRange = document.createRange();
                        newRange.selectNodeContents(span);
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                    } else {
                        // 선택된 텍스트가 없으면 다음 입력에 적용
                        document.execCommand('fontSize', false, '3');
                        const fontElements = messageEditor.querySelectorAll('font[size="3"]');
                        fontElements.forEach(el => {
                            if (el.style.fontSize === '') {
                                el.style.fontSize = size;
                            }
                        });
                    }
                }
            });
        });
    }
    
    // 선택 영역 유지를 위한 전역 변수
    let savedSelection = null;
    
    // 에디터에서 선택 변경 시 저장
    messageEditor.addEventListener('mouseup', () => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && messageEditor.contains(selection.anchorNode)) {
            savedSelection = selection.getRangeAt(0).cloneRange();
        }
    });
    
    messageEditor.addEventListener('keyup', () => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && messageEditor.contains(selection.anchorNode)) {
            savedSelection = selection.getRangeAt(0).cloneRange();
        }
    });
    
    // 복사 시 HTML 태그 제거하고 순수 텍스트만 복사
    messageEditor.addEventListener('copy', (e) => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const selectedText = range.toString(); // 순수 텍스트만 추출
            
            // 클립보드에 순수 텍스트만 넣기
            e.clipboardData.setData('text/plain', selectedText);
            e.preventDefault(); // 기본 동작 방지 (HTML 복사 방지)
        }
    });
    
    // 붙여넣기 시 HTML 태그 제거하고 순수 텍스트만 삽입
    messageEditor.addEventListener('paste', (e) => {
        e.preventDefault(); // 기본 붙여넣기 동작 방지
        
        // 클립보드에서 순수 텍스트만 가져오기
        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedText = clipboardData.getData('text/plain');
        
        if (pastedText) {
            // 현재 선택 영역 가져오기
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                // 선택된 텍스트 삭제
                range.deleteContents();
                // 순수 텍스트만 삽입
                const textNode = document.createTextNode(pastedText);
                range.insertNode(textNode);
                // 커서를 삽입된 텍스트 뒤로 이동
                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                // 선택 영역이 없으면 현재 커서 위치에 삽입
                document.execCommand('insertText', false, pastedText);
            }
        }
    });
    
    // Placeholder 기능 (contentEditable용)
    messageEditor.addEventListener('focus', () => {
        if (messageEditor.textContent.trim() === '') {
            messageEditor.innerHTML = '';
        }
        // 포커스 시 저장된 선택 영역 복원 시도
        if (savedSelection) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(savedSelection);
            } catch (e) {
                // 선택 영역 복원 실패 시 무시
            }
        }
    });
    
    messageEditor.addEventListener('blur', () => {
        if (messageEditor.textContent.trim() === '') {
            messageEditor.innerHTML = '';
        }
    });
    
    // 이미지 업로드 처리 (보안 강화) - 이미지 업로드가 있는 경우에만 활성화
    const imageUpload = document.getElementById('image-upload');
    const imagePreview = document.getElementById('image-preview');
    const messageTextarea = messageEditor; // 호환성을 위해 유지
    
    // 이미지 업로드가 있는 경우에만 처리
    if (imageUpload && imagePreview) {
        // 업로드 제한 설정 (서버 제한 고려)
        const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB (Base64 변환 후 약 1.3MB)
        const MAX_FILES = 3; // 최대 3개 (서버 제한 고려)
        const MAX_TOTAL_SIZE = 2 * 1024 * 1024; // 전체 최대 2MB (Base64 변환 후 약 2.6MB)
        const MAX_IMAGE_DIMENSION = 1920; // 최대 이미지 크기 (가로/세로)
        const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        
        let uploadedImages = []; // 업로드된 이미지 추적
        
        imageUpload.addEventListener('change', (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        // 파일 개수 제한
        if (uploadedImages.length + files.length > MAX_FILES) {
            alert(`최대 ${MAX_FILES}개의 이미지만 업로드할 수 있습니다. (현재: ${uploadedImages.length}개)`);
            event.target.value = ''; // 입력 초기화
            return;
        }
        
        let totalNewSize = 0;
        const validFiles = [];
        
        // 파일 검증
        Array.from(files).forEach((file) => {
            // 파일 타입 검증
            const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
            if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(fileExtension)) {
                alert(`${file.name}은(는) 지원되지 않는 파일 형식입니다.\n지원 형식: jpg, png, gif, webp`);
                return;
            }
            
            // 파일 크기 제한
            if (file.size > MAX_FILE_SIZE) {
                alert(`${file.name}의 크기가 너무 큽니다. (최대 2MB)`);
                return;
            }
            
            // 파일명 검증 (악성 파일명 방지)
            if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
                alert(`${file.name}은(는) 유효하지 않은 파일명입니다.`);
                return;
            }
            
            totalNewSize += file.size;
            validFiles.push(file);
        });
        
        // 전체 크기 제한
        const currentTotalSize = uploadedImages.reduce((sum, img) => sum + img.size, 0);
        if (currentTotalSize + totalNewSize > MAX_TOTAL_SIZE) {
            alert(`전체 이미지 크기가 너무 큽니다. (최대 ${MAX_TOTAL_SIZE / 1024 / 1024}MB)`);
            event.target.value = '';
            return;
        }
        
        // 유효한 파일만 처리 (이미지 리사이징 및 압축)
        validFiles.forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // 이미지 리사이징 (큰 이미지 축소)
                    let width = img.width;
                    let height = img.height;
                    
                    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
                        if (width > height) {
                            height = (height * MAX_IMAGE_DIMENSION) / width;
                            width = MAX_IMAGE_DIMENSION;
                        } else {
                            width = (width * MAX_IMAGE_DIMENSION) / height;
                            height = MAX_IMAGE_DIMENSION;
                        }
                    }
                    
                    // Canvas를 사용하여 이미지 리사이징 및 압축
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // JPEG 품질 설정 (파일 크기 최적화)
                    const quality = file.size > 500 * 1024 ? 0.7 : 0.85; // 큰 파일은 더 압축
                    const resizedImageUrl = canvas.toDataURL('image/jpeg', quality);
                    
                    // Base64 크기 확인
                    const base64Size = resizedImageUrl.length * 0.75; // 대략적인 바이트 크기
                    if (base64Size > MAX_FILE_SIZE * 1.5) {
                        alert(`${file.name}의 크기가 너무 큽니다. 더 작은 이미지를 사용해주세요.`);
                        return;
                    }
                    
                    // 이미지 정보 저장
                    const imageInfo = {
                        url: resizedImageUrl,
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        resized: width !== img.width || height !== img.height
                    };
                    uploadedImages.push(imageInfo);
                    
                    // 미리보기 표시
                    const previewDiv = document.createElement('div');
                    previewDiv.className = 'mb-2';
                    previewDiv.style.position = 'relative';
                    previewDiv.style.display = 'inline-block';
                    previewDiv.style.marginRight = '10px';
                    previewDiv.style.marginBottom = '10px';
                    const sizeText = imageInfo.resized ? 
                        `${(base64Size / 1024).toFixed(1)}KB (압축됨)` : 
                        `${(file.size / 1024).toFixed(1)}KB`;
                    previewDiv.innerHTML = `
                        <img src="${resizedImageUrl}" alt="Preview" style="max-width: 150px; max-height: 150px; border-radius: 4px; border: 1px solid #ddd; object-fit: cover;">
                        <button type="button" class="btn btn-sm btn-danger" style="position: absolute; top: -5px; right: -5px; width: 24px; height: 24px; padding: 0; border-radius: 50%; font-size: 12px; line-height: 1;">×</button>
                        <small style="display: block; font-size: 0.75rem; color: #666; margin-top: 4px;">${sizeText}</small>
                    `;
                    
                    // 삭제 버튼 이벤트
                    const removeBtn = previewDiv.querySelector('button');
                    removeBtn.addEventListener('click', () => {
                        previewDiv.remove();
                        // 업로드된 이미지 목록에서 제거
                        uploadedImages = uploadedImages.filter(img => img.url !== resizedImageUrl);
                        // 메시지에서 해당 이미지 태그 제거
                        const imgTags = messageEditor.querySelectorAll('img[src="' + resizedImageUrl + '"]');
                        imgTags.forEach(img => {
                            const brAfter = img.nextSibling;
                            if (brAfter && brAfter.nodeName === 'BR') {
                                brAfter.remove();
                            }
                            img.remove();
                        });
                    });
                    
                    imagePreview.appendChild(previewDiv);
                    
                    // 메시지에 이미지 태그로 삽입 (텍스트가 아닌 이미지로 표시)
                    messageEditor.focus();
                    const selection = window.getSelection();
                    
                    // 선택 영역이 없으면 에디터 끝에 추가
                    let range;
                    if (selection.rangeCount > 0) {
                        range = selection.getRangeAt(0);
                    } else {
                        range = document.createRange();
                        range.selectNodeContents(messageEditor);
                        range.collapse(false); // 끝으로 이동
                    }
                    
                    // 이미지 태그 생성
                    const imgTag = document.createElement('img');
                    imgTag.src = resizedImageUrl;
                    imgTag.style.maxWidth = '100%';
                    imgTag.style.height = 'auto';
                    imgTag.style.borderRadius = '8px';
                    imgTag.style.margin = '10px 0';
                    imgTag.style.display = 'block';
                    
                    // 현재 커서 위치에 이미지 삽입
                    range.insertNode(imgTag);
                    
                    // 이미지 뒤에 줄바꿈 추가
                    const br = document.createElement('br');
                    range.setStartAfter(imgTag);
                    range.insertNode(br);
                    
                    // 커서를 이미지 뒤로 이동
                    range.setStartAfter(br);
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                };
                
                img.onerror = () => {
                    alert(`${file.name}은(는) 유효한 이미지 파일이 아닙니다.`);
                };
                
                img.src = e.target.result;
            };
            
            reader.onerror = () => {
                alert(`${file.name} 파일을 읽는 중 오류가 발생했습니다.`);
            };
            
            reader.readAsDataURL(file);
        });
        
        // 입력 초기화 (같은 파일 다시 선택 가능하도록)
        event.target.value = '';
        });
    } // 이미지 업로드가 있는 경우에만 처리하는 블록 종료

    const guestbookForm = document.getElementById('guestbook-form');
    if (guestbookForm) guestbookForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        
        // 로딩 상태 표시
        submitButton.disabled = true;
        submitButton.textContent = '제출 중...';
        
        const title = document.getElementById('title').value.trim();
        // contentEditable에서 HTML 가져오기 및 정리
        const messageElement = document.getElementById('message');
        let message = messageElement.innerHTML.trim() || messageElement.textContent.trim();
        
        // 모바일에서 생성된 불필요한 HTML 태그 정리
        if (message) {
            message = cleanHtml(message);
        }
        
        const nickname = document.getElementById('nickname').value.trim();
        const password = document.getElementById('password').value;
        const isSecret = document.getElementById('isSecret').checked;

        // 요청 본문 크기 확인 (8MB 제한, 안전 마진)
        const requestBody = JSON.stringify({ title, message, nickname, password, isSecret });
        const requestSize = new Blob([requestBody]).size;
        const maxRequestSize = 8 * 1024 * 1024; // 8MB
        
        if (requestSize > maxRequestSize) {
            alert(`요청 크기가 너무 큽니다. (${(requestSize / 1024 / 1024).toFixed(2)}MB / 최대 8MB)\n이미지를 줄이거나 텍스트를 줄여주세요.`);
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/easy-voca`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: requestBody
            });

            // 413 오류 처리 (Payload Too Large)
            if (response.status === 413) {
                const errorText = await response.text();
                console.error('❌ 413 오류 - 요청 크기 초과:', errorText);
                alert('요청 크기가 너무 큽니다.\n\n해결 방법:\n1. 이미지를 줄이거나 제거하세요\n2. 텍스트를 줄이세요\n3. 불필요한 서식을 제거하세요');
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
                return;
            }
            
            if (response.ok) {
                // 응답이 JSON인지 확인
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const result = await response.json();
                    console.log('✅ 게시글 저장 성공:', result);
                }
                
                // 캐시 무효화
                cache.messages = null;
                cache.lastFetch = null;
                
                // 메시지 새로고침
                await loadMessages(true);
                
                // 폼 리셋 및 모달 닫기
                form.reset();
                const imagePreview = document.getElementById('image-preview');
                if (imagePreview) {
                    imagePreview.innerHTML = '';
                }
                const writeModal = bootstrap.Modal.getInstance(document.getElementById('write-post-modal'));
                if (writeModal) {
                    writeModal.hide();
                }
                
                // 성공 피드백 (선택사항)
                submitButton.textContent = '✓ 제출 완료';
                setTimeout(() => {
                    submitButton.textContent = originalButtonText;
                }, 1500);
            } else {
                // 에러 응답 처리
                const contentType = response.headers.get('content-type');
                let errorMessage = '게시글 저장에 실패했습니다.';
                
                if (contentType && contentType.includes('application/json')) {
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorMessage;
                    } catch (e) {
                        console.error('JSON 파싱 오류:', e);
                        errorMessage = `서버 오류 (${response.status}): ${response.statusText}`;
                    }
                } else {
                    // HTML 응답인 경우
                    const text = await response.text();
                    console.error('서버가 HTML을 반환했습니다:', text.substring(0, 200));
                    errorMessage = `서버 오류 (${response.status}): ${response.statusText}. 백엔드 서버가 실행 중인지 확인해주세요.`;
                }
                
                alert(`오류: ${errorMessage}`);
                submitButton.textContent = originalButtonText;
            }
        } catch (error) {
            console.error('Error while submitting guestbook entry:', error);
            let errorMessage = '네트워크 오류가 발생했습니다. 다시 시도해주세요.';
            
            if (error.message.includes('JSON')) {
                errorMessage = '서버 응답 형식 오류가 발생했습니다. 백엔드 서버를 확인해주세요.';
            } else if (error.message.includes('fetch')) {
                errorMessage = '서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.';
            }
            
            alert(errorMessage);
            submitButton.textContent = originalButtonText;
        } finally {
            submitButton.disabled = false;
        }
    });

    const editGuestbookForm = document.getElementById('edit-guestbook-form');
    if (editGuestbookForm) editGuestbookForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        
        // 로딩 상태 표시
        submitButton.disabled = true;
        submitButton.textContent = '수정 중...';
        
        const id = document.getElementById('edit-id').value;
        const title = document.getElementById('edit-title').value.trim();
        const message = document.getElementById('edit-message').value.trim();
        const nickname = document.getElementById('edit-nickname').value.trim();
        const password = document.getElementById('edit-password').value;
        const isSecret = document.getElementById('edit-isSecret').checked;

        try {
            const response = await fetch(`${API_BASE_URL}/easy-voca/updatepost`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id, password, title, message, nickname, isSecret })
            });

            if (response.ok) {
                // 응답이 JSON인지 확인
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const result = await response.json();
                    console.log('✅ 게시글 수정 성공:', result);
                }
                
                // 캐시 무효화
                cache.messages = null;
                cache.lastFetch = null;
                
                // 메시지 새로고침
                await loadMessages(true);
                
                // 폼 리셋 및 컨테이너 숨기기
                form.reset();
                document.getElementById('edit-post-container').style.display = 'none';
                document.getElementById('write-post-container').style.display = 'none';
                
                // 성공 피드백
                submitButton.textContent = '✓ 수정 완료';
                setTimeout(() => {
                    submitButton.textContent = originalButtonText;
                }, 1500);
            } else {
                // 에러 응답 처리
                const contentType = response.headers.get('content-type');
                let errorMessage = '게시글 수정에 실패했습니다.';
                
                if (contentType && contentType.includes('application/json')) {
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorMessage;
                    } catch (e) {
                        console.error('JSON 파싱 오류:', e);
                        errorMessage = `서버 오류 (${response.status}): ${response.statusText}`;
                    }
                } else {
                    // HTML 응답인 경우
                    const text = await response.text();
                    console.error('서버가 HTML을 반환했습니다:', text.substring(0, 200));
                    errorMessage = `서버 오류 (${response.status}): ${response.statusText}. 백엔드 서버가 실행 중인지 확인해주세요.`;
                }
                
                alert(`오류: ${errorMessage}`);
                submitButton.textContent = originalButtonText;
            }
        } catch (error) {
            console.error('Error while updating guestbook entry:', error);
            let errorMessage = '네트워크 오류가 발생했습니다. 다시 시도해주세요.';
            
            if (error.message.includes('JSON')) {
                errorMessage = '서버 응답 형식 오류가 발생했습니다. 백엔드 서버를 확인해주세요.';
            } else if (error.message.includes('fetch')) {
                errorMessage = '서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.';
            }
            
            alert(errorMessage);
            submitButton.textContent = originalButtonText;
        } finally {
            submitButton.disabled = false;
        }
    });

    // 이미지/동영상 링크를 HTML로 변환 (viewpost와 동일: YouTube는 링크만, href 안 URL은 건드리지 않음)
    function convertMediaLinks(text) {
        if (!text) return text;
        const hasHtml = /<[^>]+>/.test(text);
        const urlPattern = /(https?:\/\/[^\s<>"'\n\r()]+)/g;
        let result = hasHtml ? text : escapeHtml(text);
        result = result.replace(urlPattern, (match, url, offset, fullString) => {
            const str = fullString !== undefined ? fullString : result;
            const off = typeof offset === 'number' ? offset : str.indexOf(match);
            const beforeMatch = str.substring(0, off);
            if (/href\s*=\s*["']$/.test(beforeMatch.replace(/\s+/g, ' '))) return match;
            const lastATagOpen = beforeMatch.lastIndexOf('<a');
            const lastATagClose = beforeMatch.lastIndexOf('</a>');
            if (lastATagOpen > lastATagClose) return match;
            const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;
            const youtubeMatch = url.match(youtubeRegex);
            if (youtubeMatch) {
                const videoId = youtubeMatch[1];
                const youtubeUrl = 'https://www.youtube.com/watch?v=' + videoId;
                return '<a href="' + youtubeUrl + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
            }
            const vimeoRegex = /vimeo\.com\/(\d+)/;
            const vimeoMatch = url.match(vimeoRegex);
            if (vimeoMatch) {
                const vimeoUrl = 'https://vimeo.com/' + vimeoMatch[1];
                return '<a href="' + vimeoUrl + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
            }
            const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;
            if (imageExtensions.test(url)) {
                return '<img src="' + url + '" alt="Image" loading="lazy" decoding="async" style="max-width:100%;height:auto;border-radius:8px;margin:10px 0;display:block;" onerror="this.style.display=\'none\'">';
            }
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
        });
        result = result.replace(/\n/g, '<br>');
        return result;
    }

    async function loadMessages(forceRefresh = false) {
        const list = document.getElementById('guestbook-list');
        
        // 캐시 확인 (강제 새로고침이 아닌 경우)
        if (!forceRefresh && cache.messages && cache.lastFetch) {
            const now = Date.now();
            if (now - cache.lastFetch < cache.cacheTime) {
                renderMessages(cache.messages, list);
                return;
            }
        }
        
        // 로딩 상태 표시
        showLoading(list);
        
        try {
            const url = `${API_BASE_URL}/easy-voca`;
            const response = await fetch(url);
            
            // 503 에러인 경우 특별 처리
            if (response.status === 503) {
                const errorData = await response.json();
                showError(list, '데이터베이스 연결 오류', 
                    `${errorData.error || 'MongoDB 연결이 되지 않았습니다.'}<br><br>
                    <strong>해결 방법:</strong><br>
                    1. MongoDB 서비스가 실행 중인지 확인<br>
                    2. backend/.env 파일의 MONGO_URI 설정 확인<br>
                    3. 백엔드 서버를 재시작`);
                return;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const messages = await response.json();
            
            // 서버에서 에러 메시지가 있는 경우
            if (messages.error) {
                showError(list, '데이터베이스 연결 오류', 
                    `${messages.error}${messages.details ? `<br>상세: ${messages.details}` : ''}`);
                return;
            }
            
            // API 응답 형식 확인 및 정규화
            let normalizedMessages = messages;
            if (Array.isArray(messages)) {
                // 배열로 직접 반환된 경우
                normalizedMessages = { entries: messages };
            } else if (!messages.entries && messages.data) {
                // data 필드에 있는 경우
                normalizedMessages = { entries: Array.isArray(messages.data) ? messages.data : [] };
            } else if (!messages.entries) {
                // entries가 없는 경우
                normalizedMessages = { entries: [] };
            }
            
            // 캐시 업데이트
            cache.messages = normalizedMessages;
            cache.lastFetch = Date.now();
            
            // 메시지 렌더링
            renderMessages(normalizedMessages, list);
            
        } catch (error) {
            console.error('❌ Error while loading messages:', error);
            console.error('❌ Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            let errorMessage = `백엔드 서버(${API_BASE_URL})가 실행 중인지 확인해주세요.`;
            
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                errorMessage += '<br><br><strong>가능한 원인:</strong><br>';
                errorMessage += '1. 백엔드 서버가 실행되지 않았습니다<br>';
                errorMessage += '2. CORS 설정 문제일 수 있습니다<br>';
                errorMessage += '3. 네트워크 연결을 확인해주세요';
            }
            
            errorMessage += `<br><br><strong>에러 메시지:</strong> ${error.message}`;
            
            showError(list, '게시글을 불러올 수 없습니다', errorMessage);
        }
    }
    
    function renderMessages(messages, container) {
        renderGuestbookTable(container, messages, {
            postPage: 'popular-voca.html',
            apiMode: apiMode,
            board: 'easy-voca',
            apiBaseUrl: API_BASE_URL,
            hideViewsAndLikes: true
        });
    }

    window.deletePost = async function (id) {
        const password = prompt('비밀번호를 입력하세요:');
        if (!password) return;
        
        if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/easy-voca/deletepost`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id, password })
            });

            if (response.ok) {
                // 캐시 무효화
                cache.messages = null;
                cache.lastFetch = null;
                await loadMessages(true);
            } else {
                const errorData = await response.json();
                alert(`오류: ${errorData.error || '게시글 삭제에 실패했습니다.'}`);
            }
        } catch (error) {
            console.error('Error while deleting post:', error);
            alert('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
        }
    };

    window.editPost = async function (id) {
        const password = prompt('비밀번호를 입력하세요:');
        if (!password) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/easy-voca/viewpost`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id, password })
            });

            if (response.ok) {
                const data = await response.json();
                const entry = data.entry;

                document.getElementById('edit-id').value = entry._id;
                document.getElementById('edit-title').value = entry.title;
                document.getElementById('edit-message').value = entry.message;
                document.getElementById('edit-nickname').value = entry.nickname;
                document.getElementById('edit-isSecret').checked = entry.isSecret;

                document.getElementById('write-post-container').style.display = 'none';
                document.getElementById('edit-post-container').style.display = 'block';
                
                // 편집 컨테이너로 스크롤
                document.getElementById('edit-post-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                const errorData = await response.json();
                alert(`오류: ${errorData.error || '게시글을 불러올 수 없습니다.'}`);
            }
        } catch (error) {
            console.error('Error while fetching post for edit:', error);
            alert('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
        }
    };

    window.adminDeletePost = async function (id) {
        const adminPasswordInput = prompt('관리자 비밀번호를 입력하세요:');
        if (!adminPasswordInput) return;
        
        if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/easy-voca/admin/deletepost`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id, adminPasswordInput })
            });

            if (response.ok) {
                // 캐시 무효화
                cache.messages = null;
                cache.lastFetch = null;
                await loadMessages(true);
            } else {
                const errorData = await response.json();
                alert(`오류: ${errorData.error || '게시글 삭제에 실패했습니다.'}`);
            }
        } catch (error) {
            console.error('Error while deleting post as admin:', error);
            alert('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
        }
    };

    // 페이지 가시성 변경 시 캐시 무효화 (다른 탭에서 돌아왔을 때)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && cache.lastFetch) {
            const now = Date.now();
            // 5분 이상 지났으면 자동 새로고침
            if (now - cache.lastFetch > 300000) {
                cache.messages = null;
                cache.lastFetch = null;
                loadMessages(true);
            }
        }
    });
});

